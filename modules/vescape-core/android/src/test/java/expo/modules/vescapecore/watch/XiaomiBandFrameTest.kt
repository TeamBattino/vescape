package expo.modules.vescapecore.watch

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class XiaomiBandFrameTest {
    private fun frame(speed: Float, duty: Float, flags: Int = 0): ByteArray =
        ByteBuffer.allocate(10).order(ByteOrder.LITTLE_ENDIAN).put(2.toByte()).put(flags.toByte()).putFloat(speed).putFloat(duty).array()

    @Test fun forwardsUnitsAndFlagsWithoutDoubleConversion() {
        val json = JSONObject(String(XiaomiBandFrame.encode(frame(30.5f, 74f, 1))!!))
        assertEquals(30.5, json.getDouble("speed"), 0.001)
        assertEquals(74.0, json.getDouble("duty"), 0.001)
        assertTrue(json.getBoolean("stale"))
        assertFalse(json.getBoolean("waiting"))
    }
    @Test fun missingSpeedWaitsAndExcludedDutyRemainsNull() {
        val waiting = JSONObject(String(XiaomiBandFrame.encode(frame(Float.NaN, Float.NaN))!!))
        assertTrue(waiting.getBoolean("waiting"))
        assertTrue(waiting.isNull("speed")); assertTrue(waiting.isNull("duty"))
        val stopped = JSONObject(String(XiaomiBandFrame.encode(frame(0f, Float.NaN))!!))
        assertFalse(stopped.getBoolean("waiting")); assertTrue(stopped.isNull("duty"))
    }
    @Test fun includesBoardBatteryFromThirdLane() {
        val frame = ByteBuffer.allocate(14).order(ByteOrder.LITTLE_ENDIAN)
            .put(3.toByte()).put(0.toByte()).putFloat(30f).putFloat(55f).putFloat(82f).array()
        val json = JSONObject(String(XiaomiBandFrame.encode(frame)!!))
        assertEquals(82.0, json.getDouble("battery"), 0.001)
    }
    @Test fun rejectsTruncatedFramesAndMissingLanes() {
        assertNull(XiaomiBandFrame.encode(byteArrayOf(11, 0, 0, 0)))
        val truncated = frame(30f, 50f).also { it[0] = 11 }
        assertNull(XiaomiBandFrame.encode(truncated))
        assertNull(XiaomiBandFrame.encode(frame(30f, 50f).also { it[0] = 1 }))
    }
}
