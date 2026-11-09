# Permission modes

Permission modes control when an agent needs your approval to act. Choose a mode in the message
composer; it applies to that thread. In a thread on your default mode, open **Permissions** from
the effort menu or press `mod+shift+a`. A thread on another mode, or a model without an effort
menu, shows the mode next to the model.

Set the default for new threads in **Settings → General → New threads → Permissions**.
Projects can override the environment default. New threads use this setting rather than the
mode of the thread you were viewing. The initial default is **Full access**; existing threads
and modes you choose in a draft keep their permissions.

| Mode                  | Behavior                                                                              |
| --------------------- | ------------------------------------------------------------------------------------- |
| **Supervised**        | Requests approval for commands and file changes.                                      |
| **Auto-accept edits** | Approves file edits automatically; other actions can still require approval.          |
| **Auto**              | Uses the provider's automatic review to approve routine actions and ask about others. |
| **Full access**       | Allows commands and edits without approval prompts.                                   |

Approve or reject requests in the conversation to let the agent continue. Permission modes do
not prevent the agent from asking questions about the task.

To reject a request and redirect the agent, type what it should do instead while the request is
waiting, then choose **Decline and tell** the agent. Claude and OpenCode receive your
instructions with the rejection. Other providers receive them as your next message.

Commands that are hard to undo, such as deleting your home folder, force-pushing to `main`, or
`git reset --hard`, show what they would do and need **Hold to allow**: press and hold the button,
or hold <kbd>⌘</kbd> <kbd>Enter</kbd> (<kbd>Ctrl</kbd> <kbd>Enter</kbd> on Windows and Linux), for
one second. On mobile, long-press the button. These commands cannot be allowed for the whole
session.

## Provider differences

Providers enforce permissions differently. Some read-only actions can proceed in **Supervised**.
**Auto** uses automatic review on Codex, Claude, and Cursor; providers without an equivalent,
including OpenCode and Antigravity, fall back to asking.

For Grok, **Always allow this session** remembers the matching command or tool input. Other
actions still require approval.

Antigravity can still send native approval requests in **Full access**. It only offers remembered
approvals for actions that support them.

See the [provider guides](./install.md#providers) for setup and provider-specific limits.
