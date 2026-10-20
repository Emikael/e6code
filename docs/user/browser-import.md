# Import browser sessions

The desktop app can import cookies from another browser so you can reuse its signed-in sessions
in the preview browser.

Open **Settings → Integrations → Browser profiles → Add profile**, then choose a browser under
**Import from**. Close the source browser before importing, and allow an operating-system keyring
unlock prompt if one appears.

This is a one-time copy. Later login changes stay separate between the two browsers, and some
sites may still require you to sign in again.

Imported cookies stay in the preview profile you imported them into. When an agent opens a
browser, it uses a separate profile that does not receive those cookies. Driving any other
preview tab asks you first. The prompt names the browser and profile when the cookies were
imported. Allowing it applies only to that tab until you quit the app. Choosing **Don't allow**
sticks for that tab until you quit. While the permission is on, the preview shows it, and you
can revoke it from that banner.

On macOS, Safari imports need Full Disk Access. Choose **Allow**, drag E6 Code into the
System Settings permission list, and turn access on. **Continue** becomes available when access
is detected. macOS may require you to quit and reopen E6 Code before the grant applies; reopen
the import wizard afterward. You can revoke Full Disk Access once the import is done.

On Windows, import supports Firefox and Helium profiles that use standard profile encryption.
Other Chromium-based browsers use app-bound encryption and cannot be imported. Partitioned cookies
are skipped on all platforms.
