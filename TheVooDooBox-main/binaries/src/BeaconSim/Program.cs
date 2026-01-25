using System;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

namespace BeaconSim
{
    class Program
    {
        private static readonly HttpClient client = new HttpClient();

        static async Task Main(string[] args)
        {
            Console.WriteLine("[*] Starting BeaconSim (Network Telemetry) Simulation...");
            Console.WriteLine("[*] Will perform 5 beacons with 2s interval.");

            for (int i = 1; i <= 5; i++)
            {
                try
                {
                    Console.WriteLine($"[*] Beacon {i}/5 sent to 'example.com'...");
                    var response = await client.GetAsync("http://example.com");
                    Console.WriteLine($"[+] Response Code: {response.StatusCode}");
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[!] Request failed (expected in isolated labs): {ex.Message}");
                }

                if (i < 5) Thread.Sleep(2000);
            }

            Console.WriteLine("[*] Simulation Finished.");
        }
    }
}
