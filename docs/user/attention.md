# Attention

E6 Code keeps what needs you in one place and holds back what can wait, so you can run several
agents without watching all of them. Every control is in **Settings → Attention** on web and
desktop, and each one is saved on this device or browser.

To change several at once, pick a starting point at the top of that page. **Quiet** notifies only
when an agent is blocked, **Standard** also tells you when a thread you sent a message to finishes,
and **Detailed** notifies for every update, shows agent activity live, plays a sound, and shows
the full composer controls. Each control below can still be changed on its own afterward.

## See what needs you

On web and desktop, the sidebar's **Needs you** section lists threads blocked on you first: an
agent waiting for an approval, waiting for your answer, or failed. Threads to review follow: a
plan that is ready, and a finished turn you have not opened yet. Each thread also keeps its usual
place in the list below. Blocked threads older than a day fold into one **Earlier** row, which
can snooze them together. Turn the section off with **Needs you at the top of the sidebar**.

Press `mod+alt+n`, or choose **Go to next thread that needs you** in the command palette, to open
the next one: blocked threads first, then those to review. The number of blocked threads also
shows in the browser tab's title and on the desktop app's dock icon.

The start screen lists the same threads under the composer, under **Needs you**, **To review**,
and **Working**. You can answer the first approval there without opening its thread. Enter never
approves on the start screen, and a command that is hard to undo still needs
[Hold to allow](./permission-modes.md).

On mobile, Home shows a **Needs you** section with the threads blocked on you.

## Get notified

On web and desktop, E6 Code tells you when an agent is blocked on you: it needs an approval, asks
a question, or fails. While you work in another thread you get a notice in the app; while E6 Code
is in the background you get a system notification. Change this with **Notify me**: **When an
agent is blocked** (the default), **For every update**, or **Off**. With notifications off, the
Needs you section and the tab title still show what is waiting.

A thread you sent a message to also tells you when that turn finishes. To change this for one
thread, use **Notify me when done** in the bar under the thread's header, or turn off **Tell me
when my thread finishes** for all of them.

Other finished threads do not interrupt you. They wait until you pause (you send a message,
switch thread, return to the window, or stop typing for 20 seconds) and arrive together. Turn off
**Hold other finished threads until a pause** to hear about each one as it finishes. **Sound**
plays one short sound when an agent is blocked.

The first time an agent works in a browser, a card in the thread offers to turn system
notifications on. Browsers keep this permission per address, so a new address or tunnel asks
again. Without system notifications, what reached you while you were away appears in the app when
you return. The **Notify me** row says whether this browser allows system notifications and how to
turn them on. For phones, see [Mobile notifications](./mobile-notifications.md).

## Work without interruptions

Press `mod+alt+z`, use **Focus** in the thread's header, or choose **Enter focus** in the command
palette to show only the open thread, without the sidebar, right panel, or terminal. `mod+d`
still opens the diff. The same shortcut, **Exit focus**, or the palette leave focus mode. Escape
does not, so closing a menu cannot drop you out of it. On desktop, it is also **View → Focus
Mode**.

While focus mode is on, finished threads are held until you leave it; turn off **Hold finished
threads in focus mode** to let them through. Blocked agents and failures still come through, and
a pill in the header shows how many other threads need you.

To clear the list for a while, choose **Snooze everything except this thread** in the command
palette, and **Wake all snoozed threads** to bring them back. A thread waiting for your approval or
answer cannot be snoozed, so nothing that needs you disappears.

**Agent activity** chooses how a working agent's steps appear: **Summary** keeps its tool calls and
thinking folded to one line, and **Live** opens each step as it happens. A thread's **More** menu
in its header can choose differently for that thread. Approval requests always show.

**Motion** set to **Reduced** turns every transition in the app into an instant change, whatever
your operating system's setting.

## Pick up where you left off

When you open a thread that changed after you were away for 5 minutes or more, **Where you left
off** above the composer shows what you last asked, what the agent did since then, and the files it
changed. It is built from the thread itself, with no model call. Change when it appears with
**Show where you left off**: **After a break**, **Always**, or **Never**. To see it at any time,
choose **Where was I?** in the command palette.

Use **Add note** in that recap to leave yourself a note for the next time you open the thread. A
note to self stays with its thread, including when the thread is archived, and shows only in that
thread's recap.

While a thread is open, the bar under its header says what the agent is doing and for how long,
what it is waiting for, or how long the last turn took.

On mobile, a thread you come back to after a break shows the same **Where you left off** card
above the composer, with your note when it is saved to an environment. While an agent works, the
status above the composer shows which step of its plan it is on, such as "Step 3 of 5".

## Set a thought aside

On web and desktop, press `mod+alt+p` from any screen, or choose **Park a thought** at the top of
the sidebar or in the command palette. Type the thought and press Enter to park it, or
`mod+Enter` to start a thread with it instead. The thread you are in keeps going. Open **Parked**
in the sidebar to start a thread from a thought, put it in the composer, or delete it. The start
screen shows the first two under the composer.

Parked thoughts and notes to self stay in this browser or app until you choose to save them to an
environment. The Parked list asks once for each environment, with what it would save, such as
"Save 4 parked thoughts and 2 notes to Studio Mac?". Choose **Save**, and every device connected to
that environment sees the same list; anyone paired with that environment can read the thoughts and
notes saved there. Dismiss the question to keep everything in this browser; it is not asked again,
and **Save to …** at the foot of the list asks again when you want. **Stop saving** keeps a copy in
this browser and sends nothing more. The foot of the list says where your list is kept.

On mobile, open **Settings → Parked**. It asks the same question, and nothing is saved from the
phone until you accept. Then you can park a thought, start a task from one, or delete one. A
thought parked while the environment is unreachable shows as waiting and is saved when it is back.

A thought or note holds up to 1,000 characters. Parked holds up to 200 thoughts, and up to 200
notes. When it is full, E6 Code asks you to remove one rather than dropping an old one. If two
devices change the same note, both versions are kept, and E6 Code says so.

To set aside a message you are writing, with its attachments, use **Park it** in the composer
instead; see [Messages and context](./composer.md#park-a-draft).

## End the day

On web and desktop, choose **Done today** in the sidebar or the command palette to see the threads
you finished since midnight. Its **Wrap up** part lists what is still open, can snooze those
threads until tomorrow morning, and takes one **First thing tomorrow** line. That line appears
above the composer the next day as **First thing today**.

## Keep track of time

**Elapsed time in the thread list** shows how long each thread has been working or waiting, in
whole minutes. **Session clock** shows in the header how long E6 Code has been open today, and
**Break reminder** adds a line there after 25, 50, or 90 minutes, with **Remind me in 30m**. It
never opens a dialog or takes focus. Fifteen minutes without using E6 Code count as a break and
start a new session. Session time is counted on this device and never sent to a server.

**Open-thread reminder** shows a line in a new thread's composer when 3, 5, or 8 threads are open,
with **See them** to move to the sidebar. It never stops you from sending.

## What changed

If you used E6 Code before these features, the start screen shows a one-time **What changed** card.
**Review settings** opens **Settings → Attention**, and **Try the new look** switches the stock
theme to the Graphite accent; see [Appearance](./appearance.md).
