import https from 'https';

function main() {
  const url = 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?q=80&w=150&auto=format&fit=crop';
  console.log('Fetching Unsplash URL:', url);
  https.get(url, (res) => {
    console.log('Status Code:', res.statusCode);
    console.log('Headers:', res.headers['content-type']);
  }).on('error', (e) => {
    console.error('Fetch failed:', e);
  });
}

main();
