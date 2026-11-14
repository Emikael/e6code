import { DeviceHostUpdates } from "./DeviceHostUpdates";
import type { DeviceSummary, ScopedThreadRef } from "@e6tools/contracts";
import { MoreHorizontal } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { usePreviewMiniPlayerStore } from "~/previewMiniPlayerStore";
import { useRightPanelStore, type RightPanelSurface } from "~/rightPanelStore";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Dialog } from "~/components/ui/dialog";
import { WizardPopup } from "~/components/ui/wizard";
import { cn } from "~/lib/utils";
import { deviceEnvironment, useDeviceHubAccess, useDeviceState } from "~/state/device";
import { formatEnvironmentQueryError } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { DeviceStreamView, type DeviceStreamHandle } from "./DeviceStreamView";
import { DeviceLoadingView } from "./DeviceLoadingView";
import { DeviceSetup } from "./DeviceSetup";
import { DeviceToolsPanel } from "./DeviceToolsPanel";
import { PanelErrorCard } from "../panel/PanelErrorCard";
import { PanelSurfaceHeader } from "../panel/PanelSurfaceHeader";
import { DEVICE_ROW_STATE, deviceListGroups } from "./deviceListRows";

const deviceKey = (device: Pick<DeviceSummary, "hostId" | "id">) =>
  `${device.hostId}\u0000${device.id}`;

/** Each surface owns one host/device; only the visible surface streams. */
export function DevicePanel(props: {
  readonly threadRef: ScopedThreadRef;
  readonly surface: Extract<RightPanelSurface, { kind: "device" }>;
  readonly visible: boolean;
  readonly onDismissSetup: () => void;
}) {
  const { environmentId, threadId } = props.threadRef;
  const { state, loaded } = useDeviceState(environmentId);
  const list = useAtomCommand(deviceEnvironment.list, { reportFailure: false });
  const open = useAtomCommand(deviceEnvironment.open);
  const close = useAtomCommand(deviceEnvironment.close);
  const shutdown = useAtomCommand(deviceEnvironment.shutdown);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [pendingDevice, setPendingDevice] = useState<DeviceSummary | null>(null);
  const pendingDeviceKey = pendingDevice ? deviceKey(pendingDevice) : null;
  const [handle, setHandle] = useState<DeviceStreamHandle | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [axOverlay, setAxOverlay] = useState(false);
  const access = useDeviceHubAccess(environmentId);

  const hostDisabled = state.hostStatus === "disabled";

  // Opening setup never grants permission to install or start helpers.
  useEffect(() => {
    if (!props.visible || !loaded || hostDisabled) return;
    void list({ environmentId, input: {} });
  }, [environmentId, list, loaded, props.visible, hostDisabled]);

  const sessions = useMemo(
    () => state.sessions.filter((session) => session.threadId === threadId),
    [state.sessions, threadId],
  );
  const activeSession = props.surface.target
    ? sessions.find(
        (session) =>
          session.deviceId === props.surface.target?.deviceId &&
          session.hostId === props.surface.target.hostId,
      )
    : undefined;
  const activeDevice = activeSession
    ? state.devices.find(
        (device) => device.hostId === activeSession.hostId && device.id === activeSession.deviceId,
      )
    : undefined;

  const hostLabel = (hostId: string) =>
    state.hosts.find((host) => host.id === hostId)?.label ?? "Device host";
  const bootingDevices =
    state.bootingDevices?.filter((device) => device.threadId === threadId) ?? [];
  // Only the start this panel asked for can be cancelled; a device another thread or client is
  // starting shows "Starting" with no button.
  const groups = useMemo(
    () =>
      deviceListGroups(
        state.devices,
        state.bootingDevices ?? [],
        pendingDevice && !pendingDevice.booted ? [pendingDevice] : [],
      ),
    [pendingDevice, state.bootingDevices, state.devices],
  );
  const [setupOpen, setSetupOpen] = useState(false);
  // The device whose start the user cancelled: its open then fails, which is not an error.
  const cancelledDeviceKeyRef = useRef<string | null>(null);
  // Cancel while starting shuts the device down again; the open waiting on it then fails.
  const cancelStarting = (device: DeviceSummary) => {
    cancelledDeviceKeyRef.current = deviceKey(device);
    setOperationError(null);
    void shutdown({
      environmentId,
      input: { hostId: device.hostId, deviceId: device.id, platform: device.platform },
    }).then((result) => {
      if (result._tag === "Failure") setOperationError(formatEnvironmentQueryError(result.cause));
    });
  };

  const selectDevice = async (value: string) => {
    const device = state.devices.find((candidate) => deviceKey(candidate) === value);
    if (!device) return;
    setOperationError(null);
    cancelledDeviceKeyRef.current = null;
    setPendingDevice(device);
    try {
      const result = await open({
        environmentId,
        input: {
          threadId,
          hostId: device.hostId,
          deviceId: device.id,
          platform: device.platform,
        },
      });
      if (result._tag === "Failure") {
        if (cancelledDeviceKeyRef.current !== value) {
          setOperationError(formatEnvironmentQueryError(result.cause));
        }
      } else
        useRightPanelStore.getState().openDevice(props.threadRef, {
          hostId: result.value.hostId,
          deviceId: result.value.deviceId,
          platform: device.platform,
          name: device.name,
        });
    } finally {
      if (cancelledDeviceKeyRef.current === value) cancelledDeviceKeyRef.current = null;
      setPendingDevice(null);
    }
  };

  // Floating the device closes the panel, like the browser's floating preview.
  const floatActive = () => {
    if (!activeDevice) return;
    usePreviewMiniPlayerStore.getState().open(props.threadRef, {
      kind: "device",
      hostId: activeDevice.hostId,
      deviceId: activeDevice.id,
      platform: activeDevice.platform,
      name: activeDevice.name,
    });
    useRightPanelStore.getState().close(props.threadRef);
  };

  const closeActive = (powerOff: boolean) => {
    if (!powerOff) {
      useRightPanelStore.getState().closeSurface(props.threadRef, props.surface.id);
      return;
    }
    if (!activeSession) return;
    setOperationError(null);
    void close({
      environmentId,
      input: {
        threadId,
        hostId: activeSession.hostId,
        deviceId: activeSession.deviceId,
        shutdown: powerOff,
      },
    }).then((result) => {
      if (result._tag === "Failure") setOperationError(formatEnvironmentQueryError(result.cause));
      else useRightPanelStore.getState().closeSurface(props.threadRef, props.surface.id);
    });
  };

  const hostReady = Object.values(state.hostStatuses).some((host) => host.status === "ready");
  const hostBusy =
    !hostReady &&
    Object.values(state.hostStatuses).some(
      (host) => host.status === "installing" || host.status === "starting",
    );
  const unavailablePlatforms = state.hosts.flatMap((host) =>
    host.platforms
      .filter((platform) => !platform.available)
      .map((platform) => ({ ...platform, hostId: host.id, hostLabel: host.label })),
  );

  if (loaded && (!state.onboardingCompleted || hostDisabled)) {
    return (
      <Dialog
        open={props.visible}
        onOpenChange={(isOpen) => {
          if (!isOpen) props.onDismissSetup();
        }}
      >
        <WizardPopup>
          <DeviceSetup environmentId={environmentId} state={state} />
        </WizardPopup>
      </Dialog>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 flex-col bg-background">
      {/* Board 18: the device, its system and host, its state, then Rotate, Device settings and More. */}
      <PanelSurfaceHeader
        actions={
          activeDevice ? (
            <>
              {activeDevice.platform === "ios" ? (
                <Button
                  size="compact"
                  variant="ghost"
                  onClick={() => handle?.rotate()}
                  disabled={!handle?.inputConnected}
                >
                  Rotate
                </Button>
              ) : null}
              <Button
                size="compact"
                variant="ghost"
                aria-pressed={toolsOpen}
                className={cn(toolsOpen && "shadow-[inset_0_0_0_1px_var(--primary-edge)]")}
                onClick={() => setToolsOpen((current) => !current)}
              >
                Device settings
              </Button>
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="sm:size-7"
                      aria-label="More: home, float over chat, power off, close"
                    />
                  }
                >
                  <MoreHorizontal aria-hidden className="size-4" />
                </MenuTrigger>
                <MenuPopup align="end" className="min-w-44">
                  <MenuItem
                    disabled={!handle?.inputConnected}
                    onClick={() => handle?.pressButton("home")}
                  >
                    Home
                  </MenuItem>
                  {activeDevice.platform === "android" ? (
                    <>
                      <MenuItem
                        disabled={!handle?.inputConnected}
                        onClick={() => handle?.pressButton("back")}
                      >
                        Back
                      </MenuItem>
                      <MenuItem
                        disabled={!handle?.inputConnected}
                        onClick={() => handle?.pressButton("recents")}
                      >
                        Recents
                      </MenuItem>
                    </>
                  ) : null}
                  <MenuItem onClick={floatActive}>Float over chat</MenuItem>
                  <MenuItem onClick={() => closeActive(false)}>Close</MenuItem>
                  {/* Power off ends the device for every thread, so it stands apart from Close. */}
                  <MenuSeparator />
                  <MenuItem variant="destructive" onClick={() => closeActive(true)}>
                    Power off
                  </MenuItem>
                </MenuPopup>
              </Menu>
            </>
          ) : null
        }
      >
        {activeDevice ? (
          <>
            <span className="min-w-0 truncate font-medium text-[13px]">{activeDevice.name}</span>
            <span className="min-w-0 shrink truncate font-mono text-[11px] text-muted-foreground tabular-nums leading-[14px]">
              {`${activeDevice.version} · ${hostLabel(activeDevice.hostId)}`}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1.5 font-medium text-foreground text-xs">
              <span aria-hidden className="size-2 rounded-full bg-foreground" />
              Running
            </span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
            {props.surface.target?.name ?? pendingDevice?.name ?? "Choose a device"}
          </span>
        )}
      </PanelSurfaceHeader>
      {hostReady && state.hostStatusDetail ? (
        <div
          role="status"
          className="whitespace-pre-line border-b px-3 py-2 text-xs text-muted-foreground"
        >
          {state.hostStatusDetail}
        </div>
      ) : null}
      <DeviceHostUpdates state={state} environmentId={environmentId} />
      {bootingDevices.length > 0 ? (
        <div role="status" className="border-b px-3 py-2 text-xs text-muted-foreground">
          Starting {bootingDevices.map((device) => device.name).join(", ")}… This can take a minute.
        </div>
      ) : null}
      {operationError ? (
        <div className="border-b p-2">
          <PanelErrorCard
            title="The device did not respond"
            reason={operationError}
            reassurance="Your thread is not affected."
            actions={
              <Button size="xs" variant="ghost" onClick={() => setOperationError(null)}>
                Dismiss
              </Button>
            }
          />
        </div>
      ) : null}
      <div className="@container relative flex min-h-0 flex-1">
        {activeDevice && activeSession ? (
          <>
            <div className="relative min-h-0 min-w-0 flex-1">
              <DeviceStreamView
                key={deviceKey(activeDevice)}
                environmentId={environmentId}
                platform={activeDevice.platform}
                deviceName={activeDevice.name}
                deviceDescription={`${state.hosts.find((host) => host.id === activeDevice.hostId)?.label ?? "Device host"} · ${activeDevice.version}`}
                deviceId={activeDevice.id}
                hostId={activeDevice.hostId}
                visible={props.visible}
                axOverlay={axOverlay}
                onHandle={setHandle}
              />
            </div>
            {toolsOpen ? (
              <DeviceToolsPanel
                key={deviceKey(activeDevice)}
                environmentId={environmentId}
                device={activeDevice}
                access={access}
                axOverlay={axOverlay}
                onAxOverlayChange={setAxOverlay}
                onClose={() => setToolsOpen(false)}
                className="absolute inset-y-0 right-0 z-10 w-full max-w-72 border-l shadow-lg @[560px]:static @[560px]:w-72 @[560px]:shrink-0 @[560px]:shadow-none"
              />
            ) : null}
          </>
        ) : pendingDevice?.booted || hostBusy || !loaded ? (
          // A device that is off stays in the list while it starts, with Cancel on its row.
          <DeviceLoadingView
            name={pendingDevice?.name ?? "Devices"}
            description={
              pendingDevice
                ? `${state.hosts.find((host) => host.id === pendingDevice.hostId)?.label ?? "Device host"} · ${pendingDevice.version}`
                : ""
            }
            stage="opening"
            message={
              pendingDevice
                ? pendingDevice.booted
                  ? "Opening device…"
                  : "Starting device…"
                : state.hostStatus === "installing"
                  ? (state.hostStatusDetail ?? "Installing device support…")
                  : "Finding devices…"
            }
          />
        ) : (
          <section
            aria-label="Choose a device"
            className="flex size-full flex-col gap-3 overflow-y-auto bg-sidebar p-4"
          >
            <div className="flex flex-col gap-0.5">
              <h2 className="font-semibold text-sm">Choose a device</h2>
              <p className="text-muted-foreground text-xs">
                {groups.length > 0
                  ? "Running devices open at once. Others take a moment to start."
                  : state.hostStatus === "failed"
                    ? (state.hostStatusDetail ?? "The device hub failed to start.")
                    : "No simulators or emulators were found on this environment."}
              </p>
            </div>
            {hostReady && groups.length > 0 ? (
              <div className="flex flex-col rounded-xl border border-border bg-surface-raised px-3 py-1">
                {groups.map((group, groupIndex) => (
                  <div key={group.platform} className="flex flex-col">
                    <h3
                      className={cn(
                        "pb-0.5 font-medium text-[11px] text-muted-foreground",
                        groupIndex === 0 ? "pt-2" : "pt-2.5",
                      )}
                    >
                      {group.label}
                    </h3>
                    {group.rows.map((row, rowIndex) => {
                      const { word, action } = DEVICE_ROW_STATE[row.state];
                      const key = deviceKey(row.device);
                      return (
                        <Fragment key={key}>
                          {rowIndex > 0 ? <div aria-hidden className="h-px bg-border" /> : null}
                          <div className="flex min-h-10 items-center gap-2.5">
                            <span
                              aria-hidden
                              className={cn(
                                "size-2 shrink-0 rounded-full",
                                row.state === "running" && "bg-foreground",
                                row.state === "off" && "border-[1.5px] border-muted-foreground",
                                (row.state === "starting" || row.state === "starting-elsewhere") &&
                                  "border-[1.5px] border-dashed border-muted-foreground",
                              )}
                            />
                            <span className="min-w-0 flex-1 truncate font-medium text-[13px]">
                              {row.device.name}{" "}
                              <span className="font-mono font-normal text-[11px] text-muted-foreground tabular-nums">
                                {row.device.version}
                              </span>
                            </span>
                            <span
                              className={cn(
                                "shrink-0 font-medium text-xs",
                                row.state === "running"
                                  ? "text-foreground"
                                  : "text-muted-foreground",
                              )}
                            >
                              {word}
                            </span>
                            {action === null ? null : (
                              <Button
                                size="compact"
                                variant={row.primary ? "outline" : "ghost"}
                                aria-label={
                                  action === "Cancel"
                                    ? `Cancel starting ${row.device.name}`
                                    : `${action} ${row.device.name}`
                                }
                                disabled={
                                  action === "Cancel"
                                    ? false
                                    : pendingDeviceKey !== null && pendingDeviceKey !== key
                                }
                                onClick={() =>
                                  action === "Cancel"
                                    ? cancelStarting(row.device)
                                    : void selectDevice(key)
                                }
                              >
                                {action}
                              </Button>
                            )}
                          </div>
                        </Fragment>
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : null}
            {hostReady &&
            !state.devices.some((device) => device.platform === "android") &&
            !unavailablePlatforms.some((platform) => platform.platform === "android") ? (
              <p className="text-muted-foreground text-xs">
                No Android virtual devices found. Create one in Android Studio's Device Manager,
                then refresh.
              </p>
            ) : null}
            <p className="text-muted-foreground text-xs">
              Missing a device?{" "}
              <button
                type="button"
                className="text-foreground underline underline-offset-2"
                onClick={() => setSetupOpen(true)}
              >
                Set up devices
              </button>
              {loaded && !hostBusy ? (
                <>
                  {" · "}
                  <button
                    type="button"
                    className="text-foreground underline underline-offset-2"
                    onClick={() => void list({ environmentId, input: {} })}
                  >
                    Refresh
                  </button>
                </>
              ) : null}
            </p>
            <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
              <WizardPopup>
                <DeviceSetup environmentId={environmentId} state={state} />
              </WizardPopup>
            </Dialog>
          </section>
        )}
      </div>
    </div>
  );
}
