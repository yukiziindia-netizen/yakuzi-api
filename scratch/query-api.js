async function test() {
  try {
    const res1 = await fetch('http://localhost:3000/api/products/suggestions?search=Naruto&type=master');
    const data1 = await res1.json();
    console.log('Suggestions API Response:', JSON.stringify(data1, null, 2));

    const res2 = await fetch('http://localhost:3000/api/products/79541502-2749-4982-8baf-82d5016da674');
    const data2 = await res2.json();
    console.log('Get Product API Response:', JSON.stringify(data2, null, 2));
  } catch (err) {
    console.error('Error querying API:', err.message);
  }
}
test();
