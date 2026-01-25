using System;
using System.Diagnostics;
using System.Text;

namespace PsEncoded
{
    class Program
    {
        static void Main(string[] args)
        {
            Console.WriteLine("[*] Starting PsEncoded Simulation...");
            
            // Command: Write-Host 'VoodooBox Malicious Simulation Executed'; Start-Sleep -s 2
            string script = "Write-Host 'VoodooBox Malicious Simulation Executed'; Start-Sleep -s 2";
            byte[] bytes = Encoding.Unicode.GetBytes(script);
            string encodedCommand = Convert.ToBase64String(bytes);

            ProcessStartInfo startInfo = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = $"-EncodedCommand {encodedCommand}",
                UseShellExecute = false,
                CreateNoWindow = false
            };

            try
            {
                using (Process? process = Process.Start(startInfo))
                {
                    Console.WriteLine($"[*] Launched powershell.exe with PID: {process?.Id}");
                    process?.WaitForExit();
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[!] Error: {ex.Message}");
            }

            Console.WriteLine("[*] Simulation Finished.");
        }
    }
}
