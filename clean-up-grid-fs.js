import "dotenv/config";
import mongoose from "mongoose";
import { ObjectId } from "mongodb";
import { connectToMongoDB } from "./models/db.js";
import { Project } from "./models/project.js";

async function cleanupGridFS() {
	try {
		await connectToMongoDB();

		const db = mongoose.connection.db;

		const filesColl = db.collection("projectZips.files");

		// 1. Get all GridFS file IDs
		const allFileDocs = await filesColl
			.find({}, { projection: { _id: 1 } })
			.toArray();
		const allFileIds = new Set(allFileDocs.map((doc) => doc._id.toString()));

		// 2. Get all referenced zipFileIds from Project collection
		const allProjects = await Project.find(
			{ zipFileId: { $ne: null } },
			{ zipFileId: 1 }
		);
		const usedIds = new Set(allProjects.map((p) => p.zipFileId.toString()));

		// 3. Find orphaned file IDs
		const orphanedIds = [...allFileIds].filter((id) => !usedIds.has(id));

		if (orphanedIds.length === 0) {
			console.log("🧼 No orphaned GridFS files found.");
		} else {
			console.log(`🗑️ Found ${orphanedIds.length} orphaned files. Deleting...`);

			for (const id of orphanedIds) {
				try {
					await bucket.delete(new ObjectId(id));
					console.log(`✅ Deleted orphaned file ${id}`);
				} catch (err) {
					console.warn(`⚠️ Failed to delete file ${id}: ${err}`);
				}
			}
		}
	} catch (err) {
		console.error("❌ Cleanup failed:", err);
	} finally {
		await mongoose.disconnect();
		console.log("🔌 Disconnected from MongoDB");
	}
}

cleanupGridFS();
