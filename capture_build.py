import subprocess

def run():
    print("Running docker-compose build...")
    process = subprocess.Popen(["docker-compose", "build", "--no-cache", "hyper-bridge"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    stdout, stderr = process.communicate()
    print("STDOUT:")
    print(stdout)
    print("STDERR:")
    print(stderr)

if __name__ == "__main__":
    run()
