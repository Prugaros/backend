# last update: 2023-11-12
import asyncio
import sqlite3
import httpx
import time
import re
import math
import os
import random
try:
    import requests
except ImportError:
    print("The 'requests' library is not installed. Please install it by running 'pip install requests'")
    exit()
from urllib.parse import urlparse
from dotenv import load_dotenv
from typing import TypedDict, List, Literal
from parsel import Selector

# Load environment variables from .env file
load_dotenv()

# this is scrape result we'll receive
class ProductDetailResult(TypedDict):
    """type hint for detailed product scrape results"""
    name: str
    description: str
    price: float
    MSRP: float
    images: List[str]
    is_active: bool
    product_url: str
    sku: str


def parse_search(response: httpx.Response) -> List[dict]:
    """Parse the search page for product URLs and their stock status."""
    products = []
    sel = Selector(response.text)
    listing_boxes = sel.css(".boost-pfs-filter-products div.boost-pfs-filter-product-item")

    for box in listing_boxes:
        url = box.css('a.boost-pfs-filter-product-item-image-link::attr(href)').get()
        if url:
            full_url = f"https://ohora.co.jp{url.split('#')[0]}"
            is_active = not box.css('.soldout').get()
            products.append({"product_url": full_url, "is_active": is_active})
    
    return products

async def scrape_product_details(session: httpx.AsyncClient, url: str) -> ProductDetailResult:
    """Scrape detailed information from a single product page."""
    headers = {
        "Referer": "https://ohora.co.jp/collections/all-products"
    }
    response = await session.get(url, headers=headers)
    sel = Selector(response.text)

    # Extract data from JSON-LD script for reliability
    json_ld_script = sel.css('script[type="application/ld+json"]::text').get()
    product_data = {}
    if json_ld_script:
        import json
        try:
            data = json.loads(json_ld_script)
            product_data['name'] = data.get('name')
        except json.JSONDecodeError:
            print(f"Error decoding JSON-LD for {url}")
            data = {}
        product_data['description'] = data.get('description')
        product_data['sku'] = data.get('sku')
        if 'offers' in data and data['offers']:
            product_data['MSRP'] = float(data['offers'][0].get('price', 0))
            availability = data['offers'][0].get('availability')
            product_data['is_active'] = "InStock" in availability if availability else False

    # Fallback or supplement with direct HTML scraping if needed
    if 'name' not in product_data or not product_data['name']:
        product_data['name'] = sel.css('h1.product-single__title::text').get("").strip()
    if 'MSRP' not in product_data or not product_data['MSRP']:
        price_text = sel.css('.product__price::text').re_first(r'[\d,]+')
        product_data['MSRP'] = float(price_text.replace(',', '')) if price_text else 0.0
    if 'description' not in product_data or not product_data['description']:
        product_data['description'] = sel.css('.product-block .rte p::text').get("").strip()
    if 'sku' not in product_data or not product_data['sku']:
        product_data['sku'] = sel.css('.product-single__sku span[data-sku-id]::text').get("").strip()

    # Scrape and download all images
    image_urls = sel.css('.product__main-photos img::attr(data-photoswipe-src)').getall()
    if not image_urls:
        # Fallback for different image gallery structures
        image_urls = sel.css('.product__thumb a::attr(href)').getall()
    local_image_paths = []
    for img_url in image_urls:
        if img_url.endswith('.gif'):
            continue
        if not img_url.startswith('http'):
            img_url = 'https:' + img_url
        try:
            response = requests.get(img_url, stream=True)
            response.raise_for_status()
            
            # Generate a unique filename
            parsed_url = urlparse(img_url)
            original_filename = os.path.basename(parsed_url.path)
            filename = f"{int(time.time() * 1000)}-{original_filename}"
            
            # Correct the save path to be relative to the script's location
            script_dir = os.path.dirname(__file__)
            save_path = os.path.join(script_dir, '..', 'public', 'uploads', 'images', filename)
            
            with open(save_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            local_image_paths.append(f"/uploads/images/{filename}")
        except Exception as e:
            print(f"Failed to download image {img_url}: {e}")

    product_data['images'] = local_image_paths
    product_data['price'] = 0.0 # Default price in USD
    product_data['product_url'] = url

    print(f"Scraped data for {url}: {product_data}")
    return product_data

'''
SORTING_MAP = {
    "best_match": 12,
    "ending_soonest": 1,
    "newly_listed": "created-descending",
}
'''

async def scrape_search(
    max_pages=9999,
) -> List[ProductDetailResult]:
    """Scrape Ohora Japan for product data."""

    def make_request(page):
        return f"https://ohora.co.jp/collections/all-products?limit=24&page={page}"

    all_product_urls = []
    page = 1
    total_pages = 1 # Start with 1, will be updated

    user_agents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
    ]

    async with httpx.AsyncClient(
        headers={
            "User-Agent": random.choice(user_agents),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Cache-Control": "max-age=0",
        },
        http2=True
    ) as session:
        # Get existing products' status from the database
        backend_url = os.getenv("BACKEND_URL", "http://localhost:3001")
        api_url = f"{backend_url}/api/scrape/products-status"
        try:
            response = await session.get(api_url)
            response.raise_for_status()
            existing_products = {p['product_url']: p for p in response.json()}
            print(f"Found {len(existing_products)} existing products in the database.")
        except Exception as e:
            print(f"Failed to get existing products: {e}")
            existing_products = {}

        # Scrape collection pages to get all product URLs and statuses
        while page <= total_pages and page <= max_pages:
            print(f"Scraping collection page: {page}/{total_pages}")
            response = await session.get(make_request(page))
            
            if page == 1:
                match = re.search(r'"items":(\d+)', response.text)
                if match:
                    total_items = int(match.group(1))
                    total_pages = math.ceil(total_items / 24)
                    print(f'Total items: {total_items}, Total pages: {total_pages}')
                else:
                    print('Could not find total items. Assuming single page.')
                    total_pages = 1
            
            page_products = parse_search(response)
            print(f"Found {len(page_products)} products on page {page}.")
            if not page_products and page > 1:
                print("No more products found. Stopping collection page scraping.")
                break
            all_product_urls.extend(page_products)
            page += 1
        
        scraped_products_map = {p['product_url']: p for p in all_product_urls}
        print(f"Found {len(scraped_products_map)} unique products on the website.")

        # Identify products with changed status
        products_to_update = []
        for url, scraped_product in scraped_products_map.items():
            if url in existing_products and existing_products[url]['is_active'] != scraped_product['is_active']:
                products_to_update.append(scraped_product)
        
        if products_to_update:
            print(f"Found {len(products_to_update)} products with changed status. Updating...")
            try:
                api_token = os.getenv("ADMIN_JWT_TOKEN")
                headers = {
                    "Content-Type": "application/json",
                    "x-access-token": api_token
                }
                api_url = f"{backend_url}/api/scrape/update-statuses"
                response = await session.post(api_url, json={"productsToUpdate": products_to_update}, headers=headers)
                response.raise_for_status()
                print("Successfully updated product statuses.")
            except Exception as e:
                print(f"Failed to update product statuses: {e}")

        # Filter for new products
        new_product_urls = [p['product_url'] for p in all_product_urls if p['product_url'] not in existing_products]
        print(f"Found {len(new_product_urls)} new products to scrape.")

        # Scrape details for each new product and send to API
        scraped_products = []
        for i, url in enumerate(new_product_urls):
            print(f"Scraping product {i+1}/{len(new_product_urls)}: {url}")
            try:
                product_details = await scrape_product_details(session, url)
                
                api_token = os.getenv("ADMIN_JWT_TOKEN")
                if not api_token:
                    print("Error: ADMIN_JWT_TOKEN not found in .env file.")
                    continue
                
                headers = {
                    "Content-Type": "application/json",
                    "x-access-token": api_token
                }
                api_url = f"{backend_url}/api/scrape/upsert"
                
                response = await session.post(api_url, json=product_details, headers=headers)
                response.raise_for_status()
                print(f"Successfully upserted product: {product_details.get('name')}")
                scraped_products.append(product_details)
                await asyncio.sleep(random.uniform(2, 5)) # Be respectful to the server
            except Exception as e:
                print(f"Failed to scrape or upsert product {url}: {e}")

    return scraped_products

# Example run:
if __name__ == "__main__":
    results = asyncio.run(scrape_search())
    print(f"Result Count End: {len(results)}")
    #print(results)
