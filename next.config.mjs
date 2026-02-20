/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '4mb'
    },
    outputFileTracingIncludes: {
      '/*': ['./Name_email_mapping.xlsx']
    }
  }
};

export default nextConfig;
