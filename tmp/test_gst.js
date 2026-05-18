const https = require('https');

async function testMastersIndia() {
  const payload = JSON.stringify({
    username: "jaiswalpharma.jp@gmail.com",
    password: "Mipl@123",
    client_id: "gzBinPpAawEwvPCagt",
    client_secret: "wjHvtMHpgOuKuF1EUqYdB0sO",
    grant_type: "password"
  });

  const authOptions = {
    hostname: 'commonapi.mastersindia.co',
    path: '/oauth/access_token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'client_id': 'gzBinPpAawEwvPCagt',
      'Accept': 'application/json',
      'User-Agent': 'PharmaBag/1.0.1'
    }
  };

  const tokenResponse = await new Promise((resolve, reject) => {
    let data = '';
    const req = https.request(authOptions, res => {
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 300) {
           console.log('OAUTH ERROR:', res.statusCode, data);
           resolve({});
        } else {
           resolve(JSON.parse(data));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });

  if (!tokenResponse.access_token) {
    console.error('Failed to get token:', tokenResponse);
    return;
  }
  console.log('Got token!');

  const gstOptions = {
    hostname: 'commonapi.mastersindia.co',
    path: '/commonapis/searchgstin?gstin=24AAXCA8449B1ZE',
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${tokenResponse.access_token}`,
      'client_id': 'gzBinPpAawEwvPCagt',
      'Accept': 'application/json',
    }
  };

  await new Promise((resolve, reject) => {
    let data = '';
    const req = https.request(gstOptions, res => {
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('GST API Response:');
        console.log(data);
        resolve();
      });
    });
    req.on('error', reject);
    req.end();
  });
}

testMastersIndia().catch(console.error);
