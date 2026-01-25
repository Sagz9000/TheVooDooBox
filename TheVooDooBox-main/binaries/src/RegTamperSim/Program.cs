using System;
using Microsoft.Win32;

namespace RegTamperSim
{
    class Program
    {
        static void Main(string[] args)
        {
            Console.WriteLine("[*] Starting RegTamperSim (System Tampering) Simulation...");

            // Simulate disabling hidden files visibility (common malware tactic to hide files)
            string rootPath = @"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced";
            string valueName = "Hidden";

            try
            {
                using (RegistryKey? key = Registry.CurrentUser.OpenSubKey(rootPath, true))
                {
                    if (key != null)
                    {
                        object? originalValue = key.GetValue(valueName);
                        Console.WriteLine($"[*] Tampering with {rootPath}\\{valueName}");
                        
                        // Set to 2 (Don't show hidden files)
                        key.SetValue(valueName, 2, RegistryValueKind.DWord);
                        Console.WriteLine("[+] Value set to 2.");

                        System.Threading.Thread.Sleep(3000);

                        if (originalValue != null)
                        {
                            Console.WriteLine("[*] Restoring original value...");
                            key.SetValue(valueName, originalValue);
                            Console.WriteLine("[+] Restored.");
                        }
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
