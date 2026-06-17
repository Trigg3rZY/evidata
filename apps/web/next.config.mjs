/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source — Next compiles them.
  transpilePackages: [
    '@evidata/answer-contract',
    '@evidata/ports',
    '@evidata/safety',
    '@evidata/redaction',
    '@evidata/agent',
    '@evidata/connector-sample',
    '@evidata/db',
    '@evidata/investigation',
    '@evidata/provider-openai',
  ],
  // pglite ships WASM + dynamic requires — keep it external to the server bundle.
  serverExternalPackages: ['@electric-sql/pglite'],
};

export default nextConfig;
