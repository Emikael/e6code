# Working with threads

Use a new thread for a separate task. Choose **New worktree** when its code changes
need a separate branch and working directory.

## Start a thread

On web and desktop, a new thread keeps the current project and carries your model
and mode selections, unless the destination project has its own model default.
Its branch and workspace mode come from your configured defaults. To continue in
an existing worktree, use **New thread in this worktree** from the branch toolbar.

When you change a new thread's project, E6 Code stays in the current environment
if that project exists there. Otherwise it selects an environment that has it.

### Start in the background

In a desktop browser or the desktop app, press `Cmd+Enter` on macOS or `Ctrl+Enter`
on Windows and Linux to start a new thread and immediately open another draft. The
next draft keeps the workspace mode and base branch you selected. With **New
worktree**, each background submission creates its own worktree.

To send the same prompt to several models on web or desktop, **Shift-click** models
in a new thread's model picker to add or remove them. A regular click returns to a
single model. Choose a base branch and send. Each selection starts a separate thread
and worktree while you stay in the new thread composer. This requires a Git project.

## Pin and reorder threads

Pin a thread from its menu to keep it above your active work.

On web and desktop, unpinning, settling, snoozing, and archiving a thread each show
a notification with **Undo** for five seconds. Undo restores the thread's previous
state, including its pinned position, and reopens an archived thread you were
viewing. `mod+z` triggers the most recent Undo when no text field is focused; see
[Keybindings](./keybindings.md#commands-with-special-behavior).

On web and desktop, you can also drag files from your computer onto any thread row:
the thread opens and the files are attached in its composer, ready for
your next message. The same per-message file limits apply as when attaching
files directly; see [Attach files](./composer.md#attach-files).

On web and desktop, pinning or unpinning a thread keeps the sidebar at your current
scroll position instead of following the thread to its new place in the list.

Pinning does not prevent automatic settlement. Settling a thread removes its pin.

On web and desktop, drag a thread between sections to change its state. Drag a thread up into
the pinned section to pin it at the spot you drop it; drag a pinned thread down into the active
list to unpin it. Dragging a thread onto the **Settled** header settles it, and dragging a settled
thread into the active list un-settles it. A snoozed thread can be dragged out of the snoozed
shelf, which wakes it, but threads cannot be dragged into the shelf because snoozing needs a wake
time. Dragging a pinned thread out of the pinned section does not ask for unpin confirmation.
Pinned and active boundary labels appear only while dragging, without moving the rows. The
other rows slide aside to show where the thread will land. When you cross into another section,
the dragged thread shows the action the drop performs, with its icon: **Pin**, **Unpin**,
**Settle**, **Un-settle**, or **Wake**. Its status and hover actions hide during the drag. A pinned
thread keeps its pin only while it stays in the pinned section; once it leaves, the badge takes
over. Reordering within the same section shows no badge. When there are no pins, drag to the top
edge to pin a thread. Section labels stay readable for the whole drag, and the section the
thread is over takes the accent color. Section labels also
identify empty sections and a collapsed settled shelf.

Drag within the pinned or active section to change its order. Other rows slide aside to show the
spot where the thread will land. Drops into either section keep the position you choose. On
mobile, open a thread's menu and choose **Arrange threads**. Drag a handle within or between
**Pinned** and **Active** to reorder, pin, or unpin. Drop onto the **Settled** divider to
settle a thread. The dragged card shows the action before you release it. Expand **Snoozed**
or **Settled** to drag a parked thread back into either live section. Each drop saves; **Done** returns to the thread list.
**Move up** and **Move down** are also available in the thread menu. The server
saves the order, so it survives a refresh and appears on your other connected devices.

On web and desktop, the list also animates section changes made with thread actions such as
**Pin**, **Settle**, and **Snooze**. These transitions respect your system's reduced-motion
preference. While dragging, rows follow the insertion gap without replaying a second transition
after the drop.

New threads appear above the active threads you have arranged. Settling clears a thread's active
position, so using **Un-settle** returns it to the top. Pinning and snoozing preserve its active
position until you move it again. Thread activity does not change the order. The settled shelf
continues to use settlement time.

If dragging is unavailable for one environment, update the E6 Code server running in that
environment. Pinned and active reordering require server support. Threads from older servers keep
their default order until the server is updated.

## Settle finished work

Choose **Settle thread** from its menu to move finished work out of the active list
without deleting the conversation. **Un-settle thread** restores it to active work
and prevents automatic settlement until new activity resumes the usual rules.
Manually settling an idle thread dismisses unanswered async questions without
sending an answer or restarting the agent.

By default, environments settle inactive threads after three days and settle
threads whose pull request merged. A closed pull request can also settle an idle
thread. Work in progress, pending questions or approvals, and live background work
prevent automatic settlement. An open pull request does not prevent inactivity
settlement, but an old closed or merged pull request does not settle work you
resumed after it closed.

Change these rules in **Settings → General** on web and desktop, or **Settings → Thread behavior** on mobile.
They continue to run when your apps are closed. On web and desktop, choose an environment at the
top to change only its rules, or **All environments** to update connected environments together.
Mixed values show where the selected environments disagree. Mobile applies these
rules to connected environments that support shared settings. Offline environments
and older servers keep their previous values. Changing a rule does not reopen
already settled threads.

## Link a pull request

The server finds the PR for each unsettled thread's saved branch, even when your
apps are closed. Settled threads keep their saved links. Update the server if
automatic branch links do not appear.

On web and desktop, right-click a pull request link in a thread and choose
**Link to thread** to select a different PR. Use **Unlink from thread** on the
same link to return to the branch PR, if one exists.
The linked pull request participates in automatic settlement.

## Find and reference work

On web and desktop, open the command palette with `Cmd/Ctrl+K` to search threads
across connected environments. Message search starts after two characters and
includes your messages and final agent responses.

Use **Settings → Keybindings** to find or customize shortcuts for searching files
and copying a thread reference. A copied reference uses the thread's pull request
link when available, otherwise its thread ID. See [keybindings](./keybindings.md)
for custom configuration.

## Inspect agent work

On web and desktop, **Run details** is always the first tab of the right panel, and it never
closes. Select it to come back from Diff, Terminal, Browser, Files, or another tab. Hiding the
panel on one thread hides it on threads you have not opened tabs in, until you show it again.
On mobile, tap **Run details** in a thread's top bar.

Its sections answer what the agent is doing (**Plan**), what changed (**Changes**), who else is
working (**Subagents**), and what the thread is using (**Usage**). Plan and Changes start open;
Usage and Subagents start closed, and Subagents opens by itself when a subagent starts working.
Open or close any section and it stays that way on this device.

**Changes** lists the working tree's changed files and how many you have reviewed. Select a file
to open its diff, or choose **Review changes** to open the Diff tab. **Commit** takes you to the
commit box, and **Push**, with the number of commits, sends what the remote does not have yet. See
[Source control](./source-control.md#review-changes-in-the-diff-tab).

**Usage** shows how full the context window is, once the provider reports it (Claude and Codex
do; other providers show no context reading). Below it are the tokens and cost of every turn in
the thread, how long the latest turn ran, and the model. A cost marked `≈` is approximate: some
turns' costs were estimated from model prices, or some turns reported no cost at all. The
provider's limit window that is closest to running out reads as a share used, such as `38% used`,
with when it resets, and says **Close to the limit** when little is left or you are spending
faster than the window elapses. Providers that report no usage or limits leave these rows out; see
[Usage](./usage.md) for every window.

Subagents appear as a card in the conversation while they work. Select a subagent to show it in
**Run details**, which lists every subagent the thread spawned and the selected one's latest
activity, tokens, tool calls, and the files it changed. Select a file to open its diff. On
mobile, Run details shows each subagent's status and running time; tap a subagent to list its
files. Files are listed for Claude and Codex subagents.

To stop one running subagent without stopping the turn, choose **Stop** on its card or in its
row's menu, or press `mod+.` while it is selected. On mobile, select the subagent and tap
**Stop subagent**. Stop is available for Claude and Codex threads. A Claude workflow stops as a
whole, so its individual members do not offer Stop.

Expand a tool call in the conversation to see its full command and output.
Summaries shorten shell wrappers and can still describe the latest call after it
finishes; the call's own result shows its status.

## Read and edit files

On web and desktop, the right panel's **Files** tab opens on the files the thread changed, when
there are any; choose **All** to see the whole project, or **Browse all files** to search it.
Edits you make there save themselves after a short pause. **Undo** beside **Your edit saved** takes
back your last edit, and **Revert my edits** in the tab's **More** menu returns the file to how it
was before you started, until the agent's next turn begins. If the agent writes a file you are
editing, your text is kept and you choose **Keep mine** or take the agent's version.

## Snooze until later

Choose **Snooze → Custom…** from a thread's menu to pick a date and time in your
local time zone, or a duration in minutes, hours, or days. Durations start when
you confirm; one day means 24 hours. On web and desktop, you can also snooze
several selected threads together. Choose **Wake thread** to bring a thread back early.

## Get notified

E6 Code tells you when an agent is blocked on you and holds other finished threads until you
pause. See [Attention](./attention.md#get-notified) for what notifies you and how to change it.
