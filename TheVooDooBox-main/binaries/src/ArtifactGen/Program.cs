using System;
using System.IO;
using System.Text;

namespace ArtifactGen
{
    class Program
    {
        static void Main(string[] args)
        {
            Console.WriteLine("[*] Starting ArtifactGen (HTA/LNK) Simulation...");

            GenerateHTA();
            GenerateLNK();

            Console.WriteLine("[*] Simulation Finished.");
        }

        static void GenerateHTA()
        {
            try
            {
                string path = "simulation.hta";
                string content = @"
<html>
<head>
    <title>VoodooBox Simulation</title>
    <hta:application id=""oHTA"" applicationname=""Voodoo"" border=""thin"" />
    <script language=""VBScript"">
        Sub Window_OnLoad
            MsgBox ""VoodooBox HTA Simulation Executed!""
            Set shell = CreateObject(""WScript.Shell"")
            shell.Run ""calc.exe""
            ' self.close()
        End Sub
    </script>
</head>
<body>
    <h2>HTA Payload Simulation</h2>
</body>
</html>";
                File.WriteAllText(path, content);
                Console.WriteLine($"[+] Generated: {path}");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[!] Error generating HTA: {ex.Message}");
            }
        }

        static void GenerateLNK()
        {
            // Note: Creating a shortcut programmatically usually requires COM (Shell32 or IWshRuntimeLibrary)
            // For a simple simulation without refs, we can use a small PowerShell snippet to do it.
            try
            {
                string path = "malicious_link.lnk";
                string psScript = $"$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{Path.GetFullPath(path)}');$s.TargetPath='cmd.exe';$s.Arguments='/c notepad.exe';$s.Save()";
                
                System.Diagnostics.ProcessStartInfo psi = new System.Diagnostics.ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = $"-Command \"{psScript}\"",
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                using (var p = System.Diagnostics.Process.Start(psi))
                {
                    p?.WaitForExit();
                }
                Console.WriteLine($"[+] Generated: {path} (via PowerShell)");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[!] Error generating LNK: {ex.Message}");
            }
        }
    }
}
