const db = require("../models");
const Product = db.Product;
const Collection = db.Collection;

async function updateProducts() {
  try {
    await db.sequelize.sync();

    const collectionProductData = {
      "Disney - Magical Outing with Disney Princess": [
        "N Snow White's Apple",
        "P Snow White's Tale",
        "N Cinderella's Sparkle",
        "P Cinderella's Wish",
        "P Jasmine's Mystic",
        "P Rapunzel's Adventure",
      ],
      "Disney - One Day of Spring": [
        "N Flower for Miss Bunny",
        "N Picnic Time",
        "N Timeless Love",
        "N Zootopia Bloom",
      ],
      "Gel Me1 Petaly Spring 2025 Collection": [
        "Damour Red",
        "Noir Black",
        "Midnight Blue",
        "Frozen Blue",
        "Cashmere Taupe",
        "Royal Pink",
        "Bouquet Blanch",
        "Pixie Dust",
        "Primavera",
      ],
      "Other Gel Me1 Petaly": [
        "Toile Blue",
        "Toile Pink",
        "Amber Glow",
        "Butterfly Pea",
        "Perle",
        "Apricot Milk",
        "Satin Pink",
        "Mauve Dazzle",
        "Twilight Peach",
        "Gemstone",
        "Sea Moon",
        "Mirage",
        "Lilac Snow",
      ],
      "Gel Me1 Petaly Pedi": ["Santa Monica", "Crystal Charme", "F Butterfly Pea"],
      "Sensual Color Collection": ["N Mute Line", "N Deep"],
      "Whispers of Winter Collection": ["N Ice Queen", "N Faerie Snow"],
      "Disney - Sweet Valentine’s Day Moments Collection": [
        "N Blooming Love",
        "N Enchanted Rose",
        "N Friends in a Parfait",
      ],
      "Ohora x Ghana Valentine Collection": ["N Ghana Pink"],
      "Disney Store": [
        "N Daisy Duck",
        "N Donald Duck",
        "N Goofy",
        "N Mickey v2",
        "N Minnie v2",
        "N Pluto",
        "N Sakura Minnie",
        "Sakura Marie",
        "Sakura Lotso",
        "Cinderella",
        "Rapunzel",
        "Ariel",
        "Belle",
        "Pink Minnie",
        "Rose Minnie",
        "Red Minnie",
        "Black Minnie",
        "Beige Minnie",
        "Scar",
        "Ursula",
        "Nick Wilde",
        "N Mickey",
        "Mickey Mouse",
        "N Minnie",
        "Disney Alice",
      ],
      "Charm Your Winter Mood Collection": ["N Glossy Pink", "N Milky Lace"],
      "Romantic Christmas Collection": ["N Pixie Winter", "N Twinkle Snow"],
      "Winter Collection": ["N Shining Winter", "N Santa Puppy"],
      "Disney - Happy Holidays Collection": [
        "N Elsa's Magic",
        "Pooh's Honey Pot",
        "Tinker Bell's Neverland",
        "Marie's Loveliness",
        "Classic Mickey",
      ],
      "Disney - Each One's Life Collection": [
        "Jasmine's Wisdom",
        "Rapunzel's Wish",
        "Aurora's Dream",
        "Alice's Journey",
      ],
      "ohora x SHE. Bring Autumn To you Collection": ["N Nut Pudding", "N Sensual Mood"],
      "Autumn Colors Collection": ["N Modern Navy", "N Shine Vino"],
      "A Peaceful Day Collection": ["N Cozy Mate", "N Glimmering Leaf", "N Glint Bekko", "N Navy Touch"],
      "3rd Anniversary": ["N Glossy Aurora", "N Coral Bliss", "N Softy Canvas", "P Grape Sheer", "P Wavy Crema"],
      "The Sunniest Romance Collection": ["P Glow Beam", "P Lavo Dress"],
      "The Essence of Summer Pedi Collection": [
        "P Glitter Shower",
        "P Redberry",
        "Sweets",
        "P Mauve Universe",
        "P Love Sparkle",
        "P Silky",
      ],
      "Dashing Diva JP": [
        "Dazzling Silver",
        "Moonlit",
        "Toe Shoes",
        "Glint Ombre",
        "Glint Rosy",
        "Glint Blush",
        "Flow",
        "Glossy French",
        "Coral Blushing",
        "Sugar Smile",
      ],
      "Other": ["Storage Pouch"],
    };

    for (const collectionName in collectionProductData) {
      const collection = await Collection.findOne({ where: { Name: collectionName } });

      if (!collection) {
        console.log(`Collection not found: ${collectionName}`);
        continue;
      }

      const productNames = collectionProductData[collectionName];

      for (const productName of productNames) {
        const product = await Product.findOne({ where: { name: productName } });

        if (!product) {
          console.log(`Product not found: ${productName}`);
          continue;
        }

        product.collectionId = collection.id;
        await product.save();
        console.log(`Updated product ${productName} with collectionId ${collection.id}`);
      }
    }

    console.log("Products updated successfully!");
  } catch (error) {
    console.error("Error updating products:", error);
  }
}

updateProducts();
