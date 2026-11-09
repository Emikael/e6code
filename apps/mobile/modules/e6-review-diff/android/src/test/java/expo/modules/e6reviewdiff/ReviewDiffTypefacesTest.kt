package expo.modules.e6reviewdiff

import org.junit.Assert.assertEquals
import org.junit.Test

class ReviewDiffTypefacesTest {
  @Test
  fun resourceNamesMatchExpoFontPlugin() {
    assertEquals("xml_geist_mono_regular", expoFontResourceName("GeistMono-Regular"))
    assertEquals("xml_geist_semi_bold", expoFontResourceName("Geist-SemiBold"))
    assertEquals("xml_geist_regular", expoFontResourceName("Geist-Regular"))
  }
}
