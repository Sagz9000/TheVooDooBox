# Use a Windows-compatible GCC compiler image
FROM gcc:latest

# Install required dependencies
RUN apt-get update && apt-get install -y \
    mingw-w64 \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /build

# Copy source file
COPY telemetry_generator.c .

# Compile the Windows executable with verbose output
RUN x86_64-w64-mingw32-gcc -v \
    telemetry_generator.c \
    -o telemetry_generator.exe \
    -lwininet -lws2_32 -ladvapi32 \
    -static-libgcc \
    -O2 \
    -Wall \
    -Wno-deprecated-declarations \
    2>&1 | tee build.log || (cat build.log && exit 1)

# Default command to verify the build
CMD ["ls", "-lh", "telemetry_generator.exe"]
