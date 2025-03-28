const chromium = require('chrome-aws-lambda');
const puppeteer = require('puppeteer-core');

/**
 * Serverless function to scrape prices from Instacart
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
  
  let browser = null;
  
  try {
    // Parse the incoming request body
    const body = JSON.parse(event.body);
    const { ingredients, credentials } = body;
    
    if (!ingredients || !Array.isArray(ingredients)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Invalid request. Please provide an array of ingredients." })
      };
    }
    
    if (!credentials || !credentials.email || !credentials.password) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Invalid request. Please provide Instacart credentials." })
      };
    }
    
    // Initialize the browser for Instacart scraping
    console.log('Launching browser...');
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: process.env.CHROME_EXECUTABLE_PATH || await chromium.executablePath,
      headless: chromium.headless
    });
    
    const page = await browser.newPage();
    
    // Set a reasonable viewport size
    await page.setViewport({ width: 1280, height: 800 });
    
    // Login to Instacart
    console.log('Navigating to Instacart login page...');
    await page.goto('https://www.instacart.com/login', { waitUntil: 'networkidle0' });
    
    console.log('Entering credentials...');
    await page.type('#nextgen-authenticate.email', credentials.email);
    await page.click('button[type="submit"]');
    
    // Wait for password field to appear
    await page.waitForSelector('#nextgen-authenticate.password', { timeout: 10000 });
    await page.type('#nextgen-authenticate.password', credentials.password);
    await page.click('button[type="submit"]');
    
    // Wait for successful login
    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 });
    
    // Check if login was successful
    const url = page.url();
    if (url.includes('login')) {
      throw new Error('Login failed. Please check your credentials.');
    }
    
    console.log('Successfully logged in!');
    
    // Navigate to Food4Less store
    console.log('Navigating to Food4Less...');
    await page.goto('https://www.instacart.com/store/food-4-less/storefront', { waitUntil: 'networkidle0' });
    
    const results = [];
    
    // Search for each ingredient
    console.log('Starting to search for ingredients...');
    for (const ingredient of ingredients) {
      console.log(`Searching for ${ingredient.name}...`);
      
      try {
        // Search for the ingredient
        await page.goto(`https://www.instacart.com/store/food-4-less/search/${encodeURIComponent(ingredient.name)}`, { waitUntil: 'networkidle0' });
        
        // Check if there are no results
        const noResults = await page.evaluate(() => {
          return document.querySelector('.css-1s7lys5') !== null;
        });
        
        if (noResults) {
          console.log(`No results found for ${ingredient.name}`);
          results.push({
            ...ingredient,
            error: "No products found"
          });
          continue;
        }
        
        // Wait for product cards to load
        await page.waitForSelector('[data-testid="product-card"]', { timeout: 10000 })
          .catch(() => console.log(`No product cards found for ${ingredient.name}`));
        
        // Get the cheapest product
        const productData = await page.evaluate(() => {
          // Find all product cards
          const productCards = Array.from(document.querySelectorAll('[data-testid="product-card"]'));
          if (!productCards.length) return null;
          
          // Get data for each product
          const products = productCards.map(card => {
            // Extract product details
            const nameElement = card.querySelector('[data-testid="product-card-title"]');
            const priceElement = card.querySelector('[data-testid="price-badge"]');
            const linkElement = card.querySelector('a');
            
            // Skip if missing essential elements
            if (!nameElement || !priceElement || !linkElement) return null;
            
            const name = nameElement.textContent.trim();
            const priceText = priceElement.textContent.trim();
            const url = linkElement.href;
            
            // Parse the price from text (e.g., "$1.99" -> 1.99)
            const priceMatch = priceText.match(/\$([0-9]+\.[0-9]+)/);
            const price = priceMatch ? parseFloat(priceMatch[1]) : null;
            
            return { name, price, url, priceText };
          }).filter(p => p !== null && p.price !== null);
          
          // Sort by price and return the cheapest
          if (products.length === 0) return null;
          products.sort((a, b) => a.price - b.price);
          return products[0];
        });
        
        if (productData) {
          console.log(`Found product: ${productData.name} for ${productData.priceText}`);
          results.push({
            ...ingredient,
            productName: productData.name,
            unitPrice: productData.price,
            totalPrice: productData.price * ingredient.quantity,
            url: productData.url
          });
        } else {
          console.log(`No products found for ${ingredient.name}`);
          results.push({
            ...ingredient,
            error: "Could not extract product data"
          });
        }
      } catch (error) {
        console.error(`Error processing ${ingredient.name}:`, error.message);
        results.push({
          ...ingredient,
          error: `Error: ${error.message}`
        });
      }
      
      // Add a delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));
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
  } finally {
    if (browser !== null) {
      await browser.close();
    }
  }
};