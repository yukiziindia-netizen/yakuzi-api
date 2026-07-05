const axios = require('axios');
async function test() {
  try {
    const res = await axios.get('http://localhost:3001/api/products');
    const products = res.data.data.products;
    if (products.length > 0) {
      const prodId = products[0].id;
      const detail = await axios.get('http://localhost:3001/api/products/' + prodId);
      console.log('Variants returned by backend:', JSON.stringify(detail.data.data.variants, null, 2));
    } else {
      console.log('No products');
    }
  } catch (err) {
    if (err.response) console.error(err.response.data);
    else console.error(err.message);
  }
}
test();
