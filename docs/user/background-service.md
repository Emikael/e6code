# Running E6 Code in the background

On Linux and macOS, E6 Code can run as a service for your user so you do not need
to keep a terminal open.

## Manage the service

Install the `e6` CLI first ([Install E6 Code](./install.md#command-line)), then
run these commands on the machine that will host E6 Code:

| Task                            | Command                |
| ------------------------------- | ---------------------- |
| Install and start               | `e6 service install`   |
| Inspect status and log location | `e6 service status`    |
| Move to a newer release         | `e6 update`            |
| Restart                         | `e6 service restart`   |
| Stop and remove from startup    | `e6 service uninstall` |

Uninstalling the service leaves your projects, threads, and settings intact.
Running `e6 service install` again repairs a service that `e6 service status`
reports as broken.

`e6 update` downloads the newest release on your channel and switches `e6`
and the service to it. Restarting interrupts running agent turns, terminals,
and remote clients, so it asks first; answer no and the service keeps running
the old version until you run `e6 service restart`. Pass `--yes` from a
script. A server you started by hand is left running; stop and start it again
to pick up the new version. Wait for any remote update already in progress
before updating; to match a remote client's version, follow
[Updating E6 Code](./updating.md).

Pass an exact version (`e6 update 0.0.42`) to pin one, `--channel nightly` to
switch trains, or `--allow-downgrade` to move backwards. `preview` is a
maintainers' test train: its builds can be broken and are never offered as
updates, so the installer and `e6 update` ask for confirmation before
installing one.

`e6 uninstall` removes the background service, the `e6` launcher, and the
downloaded versions after showing you the list and asking once. Your projects,
threads, and settings under `~/.e6/userdata` are kept. Pass `--yes` from a
script.

## Platform support

Linux needs systemd user services. Setup enables lingering so E6 Code starts at
boot and keeps running after logout. If this needs administrator permission,
setup prints a recovery command before changing the service.

macOS starts the service when you log in and stops it when you log out. Keep the
Mac logged in and awake for unattended remote access. Installing over SSH while
nobody is logged in at the Mac's screen can fail at the final start step; the
service is still installed and will start at the next login.

Windows background services are not supported.

E6 Connect can offer service installation during setup, but the two are managed
separately. Signing out of E6 Connect does not stop or uninstall the service.

## Troubleshooting

Start with `e6 service status` on the host. It prints the log path and, on Linux,
checks whether the installed service is running, enabled, and allowed to survive
logout.

If it stops when your SSH session closes, check for `linger-disabled`. An
administrator can enable lingering with:

```sh
sudo loginctl enable-linger "$(id -un)"
```

Over SSH, allow sudo to prompt:

```sh
ssh -t your-server 'sudo loginctl enable-linger "$(id -un)"'
```

Then retry service setup as your normal user. Run only the `loginctl` command
with sudo; running E6 Code as root creates a separate installation and Connect
identity. Without administrator access, run `e6 serve` in a terminal and keep
that session open.

| Status problem                          | Next step                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `linger-unavailable`                    | Run `loginctl show-user "$(id -un)" --property=Linger` and check that systemd-logind is available.                             |
| `user-manager-unavailable`              | Run `systemctl --user status` in a login session for the service user; check your distribution's systemd user-session support. |
| `service-disabled` or `service-stopped` | Read the log and `systemctl --user status e6code.service`, then use the repair command printed by E6 Code.                     |
| `restart-pending`                       | A newer version is installed but the service still runs the previous one. Run `e6 service restart`.                            |

On macOS, check **System Settings → General → Login Items** if the service no
longer starts at login. If agent work cannot access Desktop, Documents, or
Downloads, it may need Full Disk Access for the `e6` executable listed in
`ProgramArguments` in
`~/Library/LaunchAgents/com.e6tools.e6code.service.plist`.

For failures after signing in to E6 Connect, see
[connection troubleshooting](./remote-access.md#e6-connect-troubleshooting).
