const db = require("../models");
const Collection = db.Collection;

async function seedCollections() {
  try {
    await db.sequelize.sync();

    const collectionsData = [
      { Name: "Disney - Magical Outing with Disney Princess", DisplayOrder: 1 },
      { Name: "Disney - One Day of Spring", DisplayOrder: 2 },
      { Name: "Gel Me1 Petaly Spring 2025 Collection", DisplayOrder: 3 },
      { Name: "Other Gel Me1 Petaly", DisplayOrder: 4 },
      { Name: "Gel Me1 Petaly Pedi", DisplayOrder: 5 },
      { Name: "Sensual Color Collection", DisplayOrder: 6 },
      { Name: "Whispers of Winter Collection", DisplayOrder: 7 },
      { Name: "Disney - Sweet Valentine’s Day Moments Collection", DisplayOrder: 8 },
      { Name: "Ohora x Ghana Valentine Collection", DisplayOrder: 9 },
      { Name: "Disney Store", DisplayOrder: 10 },
      { Name: "Charm Your Winter Mood Collection", DisplayOrder: 11 },
      { Name: "Romantic Christmas Collection", DisplayOrder: 12 },
      { Name: "Winter Collection", DisplayOrder: 13 },
      { Name: "Disney - Happy Holidays Collection", DisplayOrder: 14 },
      { Name: "Disney - Each One's Life Collection", DisplayOrder: 15 },
      { Name: "ohora x SHE. Bring Autumn To you Collection", DisplayOrder: 16 },
      { Name: "Autumn Colors Collection", DisplayOrder: 17 },
      { Name: "A Peaceful Day Collection", DisplayOrder: 18 },
      { Name: "3rd Anniversary", DisplayOrder: 19 },
      { Name: "The Sunniest Romance Collection", DisplayOrder: 20 },
      { Name: "The Essence of Summer Pedi Collection", DisplayOrder: 21 },
      { Name: "Dashing Diva JP", DisplayOrder: 22 },
      { Name: "Other", DisplayOrder: 23 },
    ];

    for (const collectionData of collectionsData) {
      await Collection.create(collectionData);
      console.log(`Created collection: ${collectionData.Name}`);
    }

    console.log("Collections seeded successfully!");
  } catch (error) {
    console.error("Error seeding collections:", error);
  }
}

seedCollections();
