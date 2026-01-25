using System;
using Microsoft.Win32;
using System.IO;

namespace RegPersistSim
{
    class Program
    {
        static void Main(string[] args)
        {
            Console.WriteLine("[*] Starting RegPersistSim (Persistence) Simulation...");

            string keyName = "VoodooBoxPersistenceTest";
            string executablePath = Environment.ProcessPath ?? "C:\\Windows\\System32\\calc.exe";

            try
            {
                using (RegistryKey? key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
                {
                    if (key != null)
                    {
                        Console.WriteLine($"[*] Setting registry key HKCU...\\Run\\{keyName}");
                        key.SetValue(keyName, executablePath);
                        Console.WriteLine("[+] Key set successfully.");

                        // Wait a bit so EDR/Sysmon can catch it
                        System.Threading.Thread.Sleep(3000);

                        Console.WriteLine($"[*] Cleaning up registry key...");
                        key.DeleteValue(keyName, false);
                        Console.WriteLine("[+] Key deleted.");
                    }
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
