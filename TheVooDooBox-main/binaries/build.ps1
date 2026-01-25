# Build the docker image
docker build -t voodoobox-simulations .

# Create a container to copy files out
$containerId = docker create voodoobox-simulations

# Copy files to local out directory
docker cp "${containerId}:/binaries/." ./out/

# Remove the container
docker rm $containerId

Write-Host "Build Complete. Binaries are in ./out/"
ls ./out/
