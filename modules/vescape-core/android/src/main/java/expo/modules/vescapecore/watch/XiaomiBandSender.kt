package expo.modules.vescapecore.watch

import expo.modules.vescapecore.runtime.Cancellable
import expo.modules.vescapecore.runtime.Scheduler

/** Main-thread latest-value transport: never accumulate a queue of old wrist readings. */
internal class XiaomiBandSender(
    private val scheduler: Scheduler,
    private val now: () -> Long,
    private val deliver: (ByteArray, () -> Unit) -> Unit,
) {
    private data class Frame(val bytes: ByteArray, val intervalMs: Long, val offeredAt: Long)
    private var latest: Frame? = null
    private var wake: Cancellable? = null
    private var timeout: Cancellable? = null
    private var lastSent: Long? = null
    private var sequence = 0L
    private var inFlight: Long? = null

    fun offer(bytes: ByteArray, idle: Boolean) {
        latest = Frame(bytes, if (idle) 5000L else 200L, now())
        wake?.cancel(); wake = null
        flush()
    }

    fun reset() {
        ++sequence
        latest = null; inFlight = null; lastSent = null
        wake?.cancel(); wake = null
        timeout?.cancel(); timeout = null
    }

    private fun flush() {
        if (inFlight != null) return
        val frame = latest ?: return
        // Do not release an old buffered value after a stalled transport/producer.
        if (now() - frame.offeredAt >= 3000L) { latest = null; return }
        val delay = lastSent?.let { (it + frame.intervalMs - now()).coerceAtLeast(0L) } ?: 0L
        if (delay > 0) {
            wake = scheduler.postDelayed(delay) { wake = null; flush() }
            return
        }
        latest = null
        val token = ++sequence
        inFlight = token; lastSent = now()
        timeout = scheduler.postDelayed(3000L) { complete(token) }
        deliver(frame.bytes) { complete(token) }
    }

    private fun complete(token: Long) {
        if (inFlight != token) return
        timeout?.cancel(); timeout = null
        inFlight = null
        flush()
    }
}
