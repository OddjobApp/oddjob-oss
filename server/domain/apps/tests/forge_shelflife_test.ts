import { appForgeService } from "../app-forge.service.js";

const shelfLifeDescription = `
# 📱 App Concept: ShelfLife
**Tagline:** *Stop throwing money in the trash.*

---

## 💡 The Problem
The average household wastes nearly 30% of the food they buy simply because they forget what is in the back of the fridge. Current solutions are either too complex (full inventory management) or too simple (basic notes apps).

## 🚀 The Solution
**ShelfLife** is a streamlined, visual "expiration dashboard." It isn't just a list of what you have; it’s a prioritized view of what you need to **eat now** before it spoils.

---

## 🛠️ Core Functional Requirements
*To be used for testing the capabilities of the app builder.*

### 1. Data Management (CRUD)
* **Create:** User can add a new item (Name, Category, Expiry Date).
* **Read:** A main gallery view showing all current inventory.
* **Update:** User can "snooze" an expiry date or move an item from "Pantry" to "Fridge."
* **Delete:** A "Consumed" button that removes the item from the list and logs it as "saved."

### 2. Logic & Filtering
* **The "Heat Map" View:** Items should automatically sort by expiration date. 
    * **Red:** Expiring in < 24 hours.
    * **Yellow:** Expiring in 2–3 days.
    * **Green:** Fresh for 4+ days.
* **Category Toggles:** Filter views by location (Fridge, Freezer, Pantry).

### 3. User Interface (UI)
* **Input Forms:** Use date-pickers and dropdown menus for categories.
* **Empty States:** A "Your fridge is empty!" graphic when no data exists.
* **Cards:** Each food item displayed as a "card" with a placeholder icon.

### 4. Advanced Features (API & Integration)
* **Push Notifications:** Trigger an alert at 9:00 AM if an item is set to expire that day.
* **Recipe Search:** A button on "Red" items that opens a web-view search for "[Item Name] recipes."

---

## 🎨 Design System
* **Primary Palette:** * \`#2D5A27\` (Forest Green) - Primary Buttons
    * \`#F8F9FA\` (Soft Gray) - Background
    * \`#FF4D4D\` (Alert Red) - Urgent Items
* **Typography:** Clean Sans-Serif (e.g., Inter or Roboto).
* **Layout:** Bottom navigation bar with "Home," "Add Item," and "Settings."
`;

async function runTest() {
    console.log("--- Starting ShelfLife Forge Test ---");
    try {
        const result = await appForgeService.forgeAppInternal('analytics-dashboard', {
            name: "ShelfLife",
            slug: "shelflife-v1",
            description: shelfLifeDescription,
            organizationId: 1,
            oddjobMissionId: 1
        });
        console.log("\n--- Forge Result ---");
        console.log(JSON.stringify(result, null, 2));
        process.exit(0);
    } catch (err: any) {
        console.error("\n--- Test Failed ---");
        console.error(err.message);
        console.error(err.stack);
        process.exit(1);
    }
}

runTest();
