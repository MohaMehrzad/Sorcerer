import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { stat } from "fs/promises";
import path from "path";

const execFileAsync = promisify(execFile);

interface PickerResponse {
  canceled: boolean;
  selectedPath?: string;
  selectedType?: "file" | "directory";
  workspacePath?: string;
}

async function pickPathOnMac(): Promise<string> {
  const script = `
set selectedPath to ""
try
  set choiceResult to choose from list {"Folder", "File"} with prompt "Select what to add as workspace" default items {"Folder"} OK button name "Next" cancel button name "Cancel"
  if choiceResult is false then
    return ""
  end if

  if item 1 of choiceResult is "Folder" then
    set chosenItem to choose folder with prompt "Select workspace folder"
  else
    set chosenItem to choose file with prompt "Select workspace file"
  end if

  set selectedPath to POSIX path of chosenItem
on error number -128
  return ""
end try

return selectedPath
`;

  const { stdout } = await execFileAsync(
    "osascript",
    ["-e", script],
    {
      timeout: 300000,
      maxBuffer: 200000,
    }
  );

  return stdout.trim();
}

async function pickPathOnWindows(): Promise<string> {
  const script = `
Add-Type -AssemblyName System.Windows.Forms;
$fileDialog = New-Object System.Windows.Forms.OpenFileDialog;
$fileDialog.Title = "Select Workspace File (Cancel to choose a folder)";
$fileDialog.Filter = "All files (*.*)|*.*";
$fileDialog.Multiselect = $false;
$fileResult = $fileDialog.ShowDialog();
if ($fileResult -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $fileDialog.FileName;
  exit 0;
}
$folderDialog = New-Object System.Windows.Forms.FolderBrowserDialog;
$folderDialog.Description = "Select Workspace Folder";
$folderDialog.ShowNewFolderButton = $true;
$folderResult = $folderDialog.ShowDialog();
if ($folderResult -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $folderDialog.SelectedPath;
}
`;

  const { stdout } = await execFileAsync(
    "powershell",
    ["-NoProfile", "-STA", "-Command", script],
    {
      timeout: 300000,
      maxBuffer: 200000,
    }
  );

  return stdout.trim();
}

async function pickPath(): Promise<string> {
  if (process.platform === "darwin") {
    return pickPathOnMac();
  }

  if (process.platform === "win32") {
    return pickPathOnWindows();
  }

  throw new Error("Native workspace picker is currently supported on macOS and Windows.");
}

export async function POST() {
  try {
    const selectedPath = await pickPath();

    if (!selectedPath) {
      return NextResponse.json<PickerResponse>({
        canceled: true,
      });
    }

    const fileStat = await stat(selectedPath);
    const selectedType = fileStat.isDirectory() ? "directory" : "file";
    const workspacePath =
      selectedType === "directory" ? selectedPath : path.dirname(selectedPath);

    return NextResponse.json<PickerResponse>({
      canceled: false,
      selectedPath,
      selectedType,
      workspacePath,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to open workspace picker";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
