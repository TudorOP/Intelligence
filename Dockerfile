FROM node:24.14.0-bookworm AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgtk-3-0 libnss3 libasound2 libgbm1 libxss1 libxtst6 \
    libatk-bridge2.0-0 libdrm2 libx11-xcb1 libxkbcommon0 \
    squashfs-tools xz-utils python3 build-essential ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /project
COPY package.json package-lock.json ./
ENV NODE_LLAMA_CPP_SKIP_DOWNLOAD=true ONNXRUNTIME_NODE_INSTALL_CUDA=skip
RUN npm ci --omit=optional
COPY . .
RUN npm run runtime:linux
RUN node scripts/collect-license-notices.mjs
RUN npm run build
ENV INTELLIGENCE_DOCKER_BUILD=1
CMD ["npm", "run", "package:linux"]
