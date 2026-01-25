FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /app

# Copy all projects
COPY src/ ./src/

# Build each project
RUN dotnet publish src/PsEncoded/PsEncoded.csproj -c Release -o /out/PsEncoded
RUN dotnet publish src/LolBinSim/LolBinSim.csproj -c Release -o /out/LolBinSim
RUN dotnet publish src/BeaconSim/BeaconSim.csproj -c Release -o /out/BeaconSim
RUN dotnet publish src/RegPersistSim/RegPersistSim.csproj -c Release -o /out/RegPersistSim
RUN dotnet publish src/SchTaskSim/SchTaskSim.csproj -c Release -o /out/SchTaskSim
RUN dotnet publish src/RegTamperSim/RegTamperSim.csproj -c Release -o /out/RegTamperSim
RUN dotnet publish src/ArtifactGen/ArtifactGen.csproj -c Release -o /out/ArtifactGen

# Final stage just to hold the binaries
FROM alpine:latest
WORKDIR /binaries
COPY --from=build /out/ ./
