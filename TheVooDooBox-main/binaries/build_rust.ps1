# Build the docker image
docker build -t voodoobox-rust-simulations -f Dockerfile.rust .

# Create a container to copy files out
$containerId = docker create voodoobox-rust-simulations

# Create local output dir
If (!(Test-Path "./out_rust")) { New-Item -ItemType Directory "./out_rust" }

# Copy files to local out directory
docker cp "${containerId}:/binaries/." ./out_rust/

# Remove the container
docker rm $containerId

Write-Host "Build Complete. Rust Binaries are in ./out_rust/"
ls ./out_rust/
