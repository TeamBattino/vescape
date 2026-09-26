package expo.modules.vescapecore.watch

import expo.modules.vescapecore.runtime.TestScheduler
import org.junit.Assert.assertEquals
import org.junit.Test

class XiaomiBandSenderTest {
    private val clock = TestScheduler()
    private val sent = mutableListOf<Int>()
    private val callbacks = mutableListOf<() -> Unit>()
    private val sender = XiaomiBandSender(clock, { clock.currentTimeMs }) { bytes, complete ->
        sent.add(bytes[0].toInt()); callbacks.add(complete)
    }
    private fun offer(value: Int, idle: Boolean = false) = sender.offer(byteArrayOf(value.toByte()), idle)

    @Test fun `slow send keeps only newest frame and releases it on completion`() {
        offer(1)
        clock.advance(250); offer(2)
        clock.advance(250); offer(3)
        assertEquals(listOf(1), sent)
        callbacks[0]()
        assertEquals(listOf(1, 3), sent)
    }
    @Test fun `fast callbacks do not exceed transport rate and do not drop latest value`() {
        offer(1); callbacks[0]()
        clock.advance(50); offer(2)
        clock.advance(50); offer(3)
        clock.advance(99)
        assertEquals(listOf(1), sent)
        clock.advance(1)
        assertEquals(listOf(1, 3), sent)
    }
    @Test fun `live readings interrupt idle throttle`() {
        offer(1, idle = true); callbacks[0]()
        clock.advance(250); offer(2, idle = true)
        clock.advance(250); offer(3)
        assertEquals(listOf(1, 3), sent)
    }
    @Test fun `reset discards queued values and ignores former connection callbacks`() {
        offer(1); offer(2); sender.reset()
        offer(3); offer(4)
        callbacks[0]()
        clock.advance(250)
        assertEquals(listOf(1, 3), sent)
        callbacks[1]()
        assertEquals(listOf(1, 3, 4), sent)
    }
    @Test fun `missing callback recovers with latest frame and late callback cannot unlock newer send`() {
        offer(1)
        clock.advance(2750); offer(2)
        clock.advance(250)
        assertEquals(listOf(1, 2), sent)
        offer(3); callbacks[0]()
        clock.advance(250)
        assertEquals(listOf(1, 2), sent)
        callbacks[1]()
        assertEquals(listOf(1, 2, 3), sent)
    }
    @Test fun `stale buffered frame is discarded if producer stops`() {
        offer(1); offer(2)
        clock.advance(3000)
        assertEquals(listOf(1), sent)
    }
}
