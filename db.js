import "dotenv/config";
import mongoose from "mongoose";
import { GridFSBucket } from "mongodb";

const DB_URI = process.env.DB_URI;

export let bucket;

export async function connectToMongoDB() {
	try {
		await mongoose.connect(DB_URI);
		console.log("✅ Connected to MongoDB");

		bucket = new GridFSBucket(mongoose.connection.db, {
			bucketName: "projectZips",
		});
	} catch (err) {
		console.error("❌ MongoDB connection error:", err);
		process.exit(1);
	}
}
