# Copilot Chat Session Finder

Search and browse GitHub Copilot chat sessions stored by closed VS Code workspaces, including sessions associated with untitled multi-root workspaces.

## Features

- Searches chat session files from workspaces that are not currently open.
- Matches every word in the search query, in any order and without case sensitivity.
- Sorts matching sessions by creation date.
- Opens a session as a read-only Markdown document.
- Reopens the original folder or workspace in a new VS Code window when it still exists.

## Usage

1. Open **Chat Session Finder** from the Activity Bar.
2. Enter one or more search terms.
3. Select a result to browse the conversation as Markdown.
4. Use the arrow action on a result to reopen its original workspace.

## Data Access

The extension reads local VS Code workspace storage to locate GitHub Copilot chat session files. Search and rendering happen locally. The extension does not upload session contents or collect telemetry.

Currently open workspace storage is excluded on macOS, Linux, and Windows using lightweight markers coordinated between extension hosts.

## Requirements

- VS Code 1.90 or newer.
- GitHub Copilot Chat sessions stored in the local VS Code profile.

## Limitations

VS Code's chat session storage format is internal and may change between releases. Sessions whose files were deleted by VS Code cannot be recovered.

## License

MIT