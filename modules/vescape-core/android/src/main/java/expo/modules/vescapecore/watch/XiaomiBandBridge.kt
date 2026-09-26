package expo.modules.vescapecore.watch

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.xiaomi.xms.wearable.Wearable
import com.xiaomi.xms.wearable.auth.Permission
import org.json.JSONObject

/** Android/Mi Fitness transport. iOS explicitly reports unsupported in the native API.
 * Native owns the connection so JS suspension does not interrupt board telemetry.
 * @parity /watch/xiaomi-band/src/pages/home/home.ux
 */
internal object XiaomiBandBridge {
    private val main = Handler(Looper.getMainLooper())
    private var context: Context? = null
    @Volatile private var generation = 0
    private var observingService = false
    private var retry: Runnable? = null
    private var retryDelayMs = 3000L
    @Volatile private var nodeId: String? = null
    @Volatile private var lastSeen = 0L
    @Volatile private var phase = "disconnected"
    @Volatile private var error: String? = null
    @Volatile private var lastAck = 0L
    @Volatile private var compatibility = false
    @Volatile private var lastDelivered = 0L
    private var announcedAt = 0L
    private val sender = XiaomiBandSender(
        expo.modules.vescapecore.runtime.HandlerScheduler(main),
        SystemClock::elapsedRealtime,
        ::deliver,
    )

    fun initialize(value: Context) {
        if (context != null) return
        context = value.applicationContext
        val saved = value.getSharedPreferences("xiaomi-band", Context.MODE_PRIVATE).getString("nodeId", null)
        if (!saved.isNullOrBlank()) configure(saved)
    }
    fun status(): Map<String, Any?> = mapOf("supported" to true, "compatibility" to compatibility, "sent" to (lastDelivered > 0 && SystemClock.elapsedRealtime() - lastDelivered < 6500), "nodeId" to nodeId, "phase" to phase, "awake" to isAwake(), "error" to error, "received" to (lastAck > 0 && SystemClock.elapsedRealtime() - lastAck < 6500))
    fun canPush() = phase == "connected" && (compatibility || isAwake())
    fun isAwake() = phase == "connected" && lastSeen > 0 && SystemClock.elapsedRealtime() - lastSeen < 6500

    fun configure(id: String?, launch: Boolean = false) {
        require(id == null || id.matches(Regex("[a-zA-Z0-9_.:-]{1,80}"))) { "Enter a valid Mi Fitness device ID." }
        main.post {
            val ctx = context ?: return@post
            retry?.let(main::removeCallbacks)
            retry = null
            val ticket = ++generation
            // intentional-suppression: best-effort old listener cleanup; generation guards reject its late callbacks.
            try { nodeId?.let { Wearable.getMessageApi(ctx).removeListener(it) } } catch (_: Exception) { }
            nodeId = id; lastSeen = 0; lastAck = 0; lastDelivered = 0; compatibility = false; announcedAt = 0; sender.reset(); error = null
            ctx.getSharedPreferences("xiaomi-band", Context.MODE_PRIVATE).edit().putString("nodeId", id).apply()
            if (id == null) { phase = "disconnected"; return@post }
            phase = "connecting"
            main.postDelayed({ if (ticket == generation && phase == "connecting") { fail(Exception("Mi Fitness is not responding. Reconnecting…")) } }, 15000)
            try {
                if (!observingService) {
                    observingService = true
                    Wearable.getServiceApi(ctx).registerServiceConnectionListener(object : com.xiaomi.xms.wearable.service.OnServiceConnectionListener {
                        override fun onServiceConnected() {
                            main.post {
                                if (phase == "error" || phase == "connected") nodeId?.let { configure(it) }
                            }
                        }
                        override fun onServiceDisconnected() {
                            main.post { if (nodeId != null) fail(Exception("Mi Fitness disconnected. Reconnecting…")) }
                        }
                    })
                }
                Wearable.getAuthApi(ctx).requestPermission(id, Permission.DEVICE_MANAGER)
                    .addOnSuccessListener {
                        if (ticket != generation) return@addOnSuccessListener
                        Wearable.getMessageApi(ctx).addListener(id) { _, bytes ->
                            if (ticket == generation && bytes.size <= 512) {
                                try {
                                    val message = JSONObject(String(bytes, Charsets.UTF_8))
                                    if (message.optString("type") == "vescape.hello" && message.optInt("version") == 1) lastSeen = SystemClock.elapsedRealtime()
                                    if (message.optString("type") == "vescape.ack" && message.optInt("version") == 1) { lastAck = SystemClock.elapsedRealtime(); android.util.Log.d("VescapeBand", "Band acknowledged frame") }
                                    if (message.optString("type") == "vescape.sleep") lastSeen = 0
                                // intentional-suppression: discard malformed peer messages; they must never control the board.
                                } catch (_: Exception) { }
                            }
                        }.addOnSuccessListener {
                            if (ticket == generation) {
                                phase = "connected"; error = null; retryDelayMs = 3000L
                                android.util.Log.i("VescapeBand", "Mi Fitness listener ready")
                                // Global Band 10 is missing from Mi Fitness's third-party capability
                                // list. That same flag drops ALL inbound app packets, not only discovery.
                                Wearable.getNodeApi(ctx).getConnectedNodes().addOnSuccessListener { nodes ->
                                    if (ticket == generation) {
                                        compatibility = nodes.none { it.id == id }
                                        if (compatibility) announcePhone(ctx)
                                    }
                                }
                                if (launch) open()
                                ctx.getSharedPreferences("xiaomi-band", Context.MODE_PRIVATE).edit().putString("nodeId", id).apply()
                                Wearable.getMessageApi(ctx).sendMessage(id, "{\"type\":\"vescape.frame\",\"version\":1,\"waiting\":true}".toByteArray())
                            }
                        }.addOnFailureListener { if (ticket == generation) fail(it) }
                    }.addOnFailureListener { if (ticket == generation) fail(it) }
            } catch (failure: Exception) { fail(failure) }
        }
    }
    fun open() {
        main.post {
            val ctx = context ?: return@post
            val id = nodeId ?: return@post
            try {
                Wearable.getNodeApi(ctx).launchWearApp(id, "/pages/home")
                    .addOnSuccessListener { error = null; if (compatibility) main.postDelayed({ if (nodeId == id) announcePhone(ctx) }, 1000) }
                    .addOnFailureListener { error = "Could not open the band app. Open Vescape from the band app list." }
            } catch (failure: Exception) { error = failure.message }
        }
    }
    /**
     * Mi Fitness 3.59 Global discards the band's app-status request before its exported SDK
     * service receives it. Forward the equivalent request for OUR package and signing identity.
     * This preserves Mi Fitness's own isServiceConnected/signature checks; it neither impersonates
     * another app nor changes the band pairing. Replies remain unavailable on this firmware.
     */
    private fun announcePhone(ctx: Context) {
        if (!compatibility || phase != "connected") return
        announcedAt = SystemClock.elapsedRealtime()
        try {
            val signer = if (android.os.Build.VERSION.SDK_INT >= 28) {
                ctx.packageManager.getPackageInfo(ctx.packageName, android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES).signingInfo?.apkContentsSigners?.firstOrNull()
            } else {
                @Suppress("DEPRECATION")
                ctx.packageManager.getPackageInfo(ctx.packageName, android.content.pm.PackageManager.GET_SIGNATURES).signatures?.firstOrNull()
            } ?: return
            val fingerprint = java.security.MessageDigest.getInstance("SHA-1").digest(signer.toByteArray())
            val intent = android.content.Intent().setComponent(android.content.ComponentName("com.xiaomi.wearable", "com.xiaomi.xms.wearable.WearableXmsService"))
                .putExtra("param_basic_info_packet_id", 6)
                .putExtra("param_basic_info_package_name", ctx.packageName)
                .putExtra("param_basic_info_fingerprint", fingerprint)
            ctx.startService(intent)
            announcedAt = SystemClock.elapsedRealtime()
        } catch (_: Exception) {
            error = "Mi Fitness could not announce the connection. Open Mi Fitness, then reconnect."
        }
    }

    private fun fail(failure: Exception) {
        sender.reset()
        phase = "error"
        error = failure.message ?: "Mi Fitness connection failed."
        lastSeen = 0
        lastAck = 0
        retry?.let(main::removeCallbacks)
        // Never repeatedly prompt after a refusal or retry a mismatched signing identity.
        if (failure is com.xiaomi.xms.wearable.exception.PermissionDeniedException ||
            failure is com.xiaomi.xms.wearable.exception.SignatureVerifyFailedException) return
        val ticket = generation
        val id = nodeId ?: return
        val action = Runnable { if (ticket == generation && phase == "error") configure(id) }
        retry = action
        main.postDelayed(action, retryDelayMs)
        retryDelayMs = (retryDelayMs * 2).coerceAtMost(30000L)
    }

    fun push(bytes: ByteArray) {
        if (!canPush()) return
        val ticket = generation
        main.post {
            if (ticket != generation || !canPush()) return@post
            val message = XiaomiBandFrame.encode(bytes) ?: return@post
            val idle = compatibility && JSONObject(String(message, Charsets.UTF_8)).optBoolean("waiting")
            sender.offer(message, idle)
        }
    }

    private fun deliver(message: ByteArray, complete: () -> Unit) {
        val ctx = context
        val id = nodeId
        if (ctx == null || id == null || !canPush()) { complete(); return }
        val now = SystemClock.elapsedRealtime()
        if (compatibility && now - announcedAt >= 15000) announcePhone(ctx)
        val ticket = generation
        try {
            Wearable.getMessageApi(ctx).sendMessage(id, message)
                .addOnSuccessListener {
                    main.post {
                        if (ticket == generation) {
                            error = null
                            if (lastDelivered == 0L) android.util.Log.i("VescapeBand", "First frame delivered through Mi Fitness; oneWay=$compatibility")
                            lastDelivered = SystemClock.elapsedRealtime()
                        }
                        complete()
                    }
                }
                .addOnFailureListener {
                    main.post {
                        if (ticket == generation) error = it.message
                        complete()
                    }
                }
        } catch (failure: Exception) {
            error = failure.message
            complete()
        }
    }
}
