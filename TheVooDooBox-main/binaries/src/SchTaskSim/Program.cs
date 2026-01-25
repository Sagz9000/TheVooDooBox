using System;
using System.Diagnostics;

namespace SchTaskSim
{
    class Program
    {
        static void Main(string[] args)
        {
            Console.WriteLine("[*] Starting SchTaskSim (Scheduled Task) Simulation...");

            string taskName = "VoodooBoxTaskTest";
            string taskAction = "calc.exe";

            // Create Task
            RunCommand("schtasks.exe", $"/Create /SC ONCE /TN {taskName} /TR {taskAction} /ST 23:59 /F");
            
            // Wait
            System.Threading.Thread.Sleep(3000);

            // Delete Task
            RunCommand("schtasks.exe", $"/Delete /TN {taskName} /F");

            Console.WriteLine("[*] Simulation Finished.");
        }

        static void RunCommand(string fileName, string args)
        {
            try
            {
                Console.WriteLine($"[*] Running: {fileName} {args}");
                ProcessStartInfo startInfo = new ProcessStartInfo
                {
                    FileName = fileName,
                    Arguments = args,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };

                using (Process? process = Process.Start(startInfo))
                {
                    process?.WaitForExit();
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[!] Error: {ex.Message}");
            }
        }
    }
}
