const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Serverless function to get prices from Food4Less
 * This is a simplified version that doesn't require Puppeteer/Chrome
 */
exports.handler = async function(event, context) {
  // Set up CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  
  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'Preflight call successful' })
    };
  }
  
  try {
    // Parse the incoming request body
    const body = JSON.parse(event.body);
    const { ingredients } = body;
    
    if (!ingredients || !Array.isArray(ingredients)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Invalid request. Please provide an array of ingredients." })
      };
    }

    console.log(`Processing ${ingredients.length} ingredients`);
    
    // Process ingredients in parallel with rate limiting
    const results = [];
    for (const ingredient of ingredients) {
      try {
        console.log(`Searching for ${ingredient.name}...`);
        
        // Add some mock price data since we can't use Puppeteer
        // In a real implementation, you'd use a different API or approach
        const productData = await getMockProductData(ingredient.name);
        
        results.push({
          ...ingredient,
          productName: productData.name,
          unitPrice: productData.price,
          totalPrice: productData.price * ingredient.quantity,
          url: productData.url
        });
        
      } catch (error) {
        console.error(`Error processing ${ingredient.name}:`, error.message);
        results.push({
          ...ingredient,
          error: `Error: ${error.message}`
        });
      }
      
      // Add a small delay between requests
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ results })
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal server error: " + error.message })
    };
  }
};

/**
 * Mock function to get product data
 * In a real implementation, this would use a different API or approach
 */
async function getMockProductData(ingredient) {
  // Generate realistic mock data based on the ingredient
  const brands = ["Food4Less", "Kroger", "Simple Truth", "Private Selection", "Great Value"];
  const brand = brands[Math.floor(Math.random() * brands.length)];
  const basePrice = (2.0 + Math.random() * 5).toFixed(2);
  const name = `${brand} ${ingredient.charAt(0).toUpperCase() + ingredient.slice(1)}`;
  
  // Generate a fake URL
  const slug = ingredient.toLowerCase().replace(/\s+/g, '-');
  const url = `https://www.food4less.com/p/${slug}`;
  
  return {
    name: name,
    price: parseFloat(basePrice),
    url: url
  };
}