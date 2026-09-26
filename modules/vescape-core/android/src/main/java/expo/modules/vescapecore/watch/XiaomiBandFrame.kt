package expo.modules.vescapecore.watch

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.json.JSONObject

/** @parity /watch/xiaomi-band/src/common/frame.js */
internal object XiaomiBandFrame {
    fun encode(bytes: ByteArray): ByteArray? {
        if (bytes.size < 10) return null
        val count = bytes[0].toInt() and 255
        if (count < 2 || bytes.size < 2 + count * 4) return null
        val data = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        data.position(2)
        val speed = data.float.toDouble()
        val duty = data.float.toDouble()
        val battery = if (count >= 3) data.float.toDouble() else Double.NaN
        return JSONObject().apply {
            put("type", "vescape.frame"); put("version", 1)
            put("stale", bytes[1].toInt() and 1 != 0)
            put("waiting", bytes[1].toInt() and 2 != 0 || !speed.isFinite())
            put("speed", if (speed.isFinite()) speed else JSONObject.NULL)
            put("duty", if (duty.isFinite()) duty else JSONObject.NULL)
            put("battery", if (battery.isFinite()) battery else JSONObject.NULL)
        }.toString().toByteArray(Charsets.UTF_8)
    }
}
