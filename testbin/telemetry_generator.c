/*
 * Telemetry Generator - Test Binary for Malware Lab Sensor
 * 
 * This program generates various telemetry events including:
 * - Registry modifications (RunOnce, Startup)
 * - Network connections (simulated C2 traffic)
 * - File operations
 * - Process creation
 * - DNS queries
 */

#define WINVER 0x0601
#define _WIN32_WINNT 0x0601

#include <windows.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <wininet.h>
#include <stdio.h>
#include <time.h>
#include <string.h>

#pragma comment(lib, "wininet.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "ws2_32.lib")

// Function prototypes
void CreateRegistryEntries();
void MakeWebRequests();
void CreateFiles();
void PerformDNSLookups();
void ModifySystemTime();
void CreateTestMutex();
void SleepRandom();

int main(int argc, char* argv[]) {
    // Ensure we have a console window
    if (!GetConsoleWindow()) {
        AllocConsole();
        freopen("CONOUT$", "w", stdout);
        freopen("CONOUT$", "w", stderr);
    }

    // Set unbuffered output for real-time streaming to screen
    setvbuf(stdout, NULL, _IONBF, 0);

    printf("====================================================\n");
    printf("        MALWARE LAB TELEMETRY GENERATOR             \n");
    printf("====================================================\n");
    printf("[*] Starting telemetry generation stream...\n\n");

    // Initialize Winsock
    WSADATA wsaData;
    if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0) {
        printf("[-] WSAStartup failed\n");
        return 1;
    }

    // Initialize random seed
    srand((unsigned int)time(NULL));

    // Create mutex (common malware behavior)
    printf("[STREAM] Creating process mutex...\n");
    CreateTestMutex();
    SleepRandom();

    // Create registry persistence entries
    printf("[STREAM] Modifying registry keys for persistence...\n");
    CreateRegistryEntries();
    SleepRandom();

    // Make web requests (simulated C2 traffic)
    printf("[STREAM] Initiating C2 network beaconing...\n");
    MakeWebRequests();
    SleepRandom();

    // Create suspicious files
    printf("[STREAM] dropper.exe simulation: creating files...\n");
    CreateFiles();
    SleepRandom();

    // Perform DNS lookups
    printf("[STREAM] Performing DNS enumeration...\n");
    PerformDNSLookups();
    SleepRandom();

    printf("\n[+] Telemetry generation complete!\n");
    printf("[*] Press any key to exit...\n");
    getchar();

    WSACleanup();
    return 0;
}

void CreateRegistryEntries() {
    HKEY hKey;
    LONG result;
    char exePath[MAX_PATH];
    
    // Get current executable path
    GetModuleFileNameA(NULL, exePath, MAX_PATH);

    // Create RunOnce entry
    result = RegOpenKeyExA(HKEY_CURRENT_USER, 
                          "Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce", 
                          0, KEY_WRITE, &hKey);
    
    if (result == ERROR_SUCCESS) {
        RegSetValueExA(hKey, "TelemetryTest", 0, REG_SZ, 
                      (BYTE*)exePath, (DWORD)strlen(exePath) + 1);
        printf("  [+] Created RunOnce registry entry\n");
        RegCloseKey(hKey);
    } else {
        printf("  [-] Failed to create RunOnce entry (Error: %ld)\n", result);
    }

    // Create Run entry (Startup)
    result = RegOpenKeyExA(HKEY_CURRENT_USER, 
                          "Software\\Microsoft\\Windows\\CurrentVersion\\Run", 
                          0, KEY_WRITE, &hKey);
    
    if (result == ERROR_SUCCESS) {
        RegSetValueExA(hKey, "TelemetryService", 0, REG_SZ, 
                      (BYTE*)exePath, (DWORD)strlen(exePath) + 1);
        printf("  [+] Created Run registry entry (Startup)\n");
        RegCloseKey(hKey);
    } else {
        printf("  [-] Failed to create Run entry (Error: %ld)\n", result);
    }

    // Create custom registry key for additional telemetry
    result = RegCreateKeyExA(HKEY_CURRENT_USER, 
                            "Software\\TelemetryTest", 
                            0, NULL, REG_OPTION_NON_VOLATILE, 
                            KEY_WRITE, NULL, &hKey, NULL);
    
    if (result == ERROR_SUCCESS) {
        DWORD installTime = (DWORD)time(NULL);
        RegSetValueExA(hKey, "InstallTime", 0, REG_DWORD, 
                      (BYTE*)&installTime, sizeof(DWORD));
        RegSetValueExA(hKey, "Version", 0, REG_SZ, 
                      (BYTE*)"1.0.0", 6);
        printf("  [+] Created custom registry key with values\n");
        RegCloseKey(hKey);
    }
}

void MakeWebRequests() {
    const char* urls[] = {
        "http://example.com/c2/beacon",
        "http://httpbin.org/get",
        "http://www.google.com",
        "http://api.ipify.org",
        "http://checkip.amazonaws.com"
    };
    
    int numUrls = sizeof(urls) / sizeof(urls[0]);
    
    for (int i = 0; i < numUrls; i++) {
        HINTERNET hInternet = InternetOpenA("TelemetryBot/1.0", 
                                           INTERNET_OPEN_TYPE_DIRECT, 
                                           NULL, NULL, 0);
        
        if (hInternet) {
            HINTERNET hConnect = InternetOpenUrlA(hInternet, urls[i], 
                                                 NULL, 0, 
                                                 INTERNET_FLAG_RELOAD, 0);
            
            if (hConnect) {
                char buffer[4096];
                DWORD bytesRead;
                
                if (InternetReadFile(hConnect, buffer, sizeof(buffer), &bytesRead)) {
                    printf("  [+] Connected to: %s (%lu bytes)\n", urls[i], bytesRead);
                } else {
                    printf("  [~] Request to: %s (no data)\n", urls[i]);
                }
                
                InternetCloseHandle(hConnect);
            } else {
                printf("  [-] Failed to connect to: %s\n", urls[i]);
            }
            
            InternetCloseHandle(hInternet);
        }
        
        Sleep(500 + (rand() % 1000)); // Random delay between requests
    }
}

void CreateFiles() {
    char tempPath[MAX_PATH];
    char filePath[MAX_PATH];
    
    GetTempPathA(MAX_PATH, tempPath);
    
    // Create a suspicious config file
    snprintf(filePath, MAX_PATH, "%s\\telemetry_config.dat", tempPath);
    HANDLE hFile = CreateFileA(filePath, GENERIC_WRITE, 0, NULL, 
                              CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    
    if (hFile != INVALID_HANDLE_VALUE) {
        const char* configData = "C2_SERVER=example.com\nBEACON_INTERVAL=60\nENCRYPTION_KEY=ABC123\n";
        DWORD bytesWritten;
        WriteFile(hFile, configData, (DWORD)strlen(configData), &bytesWritten, NULL);
        CloseHandle(hFile);
        printf("  [+] Created config file: %s\n", filePath);
    }

    // Create a log file
    snprintf(filePath, MAX_PATH, "%s\\telemetry_log.txt", tempPath);
    hFile = CreateFileA(filePath, GENERIC_WRITE, 0, NULL, 
                       CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    
    if (hFile != INVALID_HANDLE_VALUE) {
        char logData[256];
        snprintf(logData, sizeof(logData), 
                 "[%lu] Telemetry test started\n[%lu] System check complete\n", 
                 (unsigned long)time(NULL), (unsigned long)time(NULL) + 1);
        DWORD bytesWritten;
        WriteFile(hFile, logData, (DWORD)strlen(logData), &bytesWritten, NULL);
        CloseHandle(hFile);
        printf("  [+] Created log file: %s\n", filePath);
    }

    // Create a hidden file
    snprintf(filePath, MAX_PATH, "%s\\.telemetry_cache", tempPath);
    hFile = CreateFileA(filePath, GENERIC_WRITE, 0, NULL, 
                       CREATE_ALWAYS, FILE_ATTRIBUTE_HIDDEN, NULL);
    
    if (hFile != INVALID_HANDLE_VALUE) {
        const char* cacheData = "CACHED_DATA_12345";
        DWORD bytesWritten;
        WriteFile(hFile, cacheData, (DWORD)strlen(cacheData), &bytesWritten, NULL);
        CloseHandle(hFile);
        printf("  [+] Created hidden file: %s\n", filePath);
    }
}

void PerformDNSLookups() {
    const char* domains[] = {
        "malware-traffic-analysis.net",
        "example.com",
        "google.com",
        "github.com",
        "suspicious-domain-test.com"
    };
    
    int numDomains = sizeof(domains) / sizeof(domains[0]);
    
    for (int i = 0; i < numDomains; i++) {
        struct hostent* host = gethostbyname(domains[i]);
        
        if (host != NULL) {
            struct in_addr addr;
            addr.s_addr = *(u_long*)host->h_addr_list[0];
            printf("  [+] DNS lookup: %s -> %s\n", domains[i], inet_ntoa(addr));
        } else {
            printf("  [-] DNS lookup failed: %s\n", domains[i]);
        }
        
        Sleep(300);
    }
}

void CreateTestMutex() {
    HANDLE hMutex = CreateMutexA(NULL, FALSE, "Global\\TelemetryTestMutex");
    
    if (hMutex != NULL) {
        if (GetLastError() == ERROR_ALREADY_EXISTS) {
            printf("  [!] Mutex already exists - another instance running?\n");
        } else {
            printf("  [+] Created mutex: Global\\TelemetryTestMutex\n");
        }
    }
}

void SleepRandom() {
    int sleepTime = 1000 + (rand() % 2000); // 1-3 seconds
    Sleep(sleepTime);
}
