import "dotenv/config";
import mongoose from "mongoose";
import { GridFSBucket } from "mongodb";

export let bucket;

export async function connectToMongoDB() {
	try {
		if (!process.env.DB_URI) {
			throw new Error(
				"❌ Missing database connection in environment variables"
			);
		}

		await mongoose.connect(process.env.DB_URI);
		console.log("✅ Connected to MongoDB");

		if (!bucket) {
			bucket = new GridFSBucket(mongoose.connection.db, {
				bucketName: "projectZips",
			});
		}
	} catch (err) {
		console.error("❌ MongoDB connection error:", err);
		// If the connection fails, exit the process
		process.exit(1);
	}
}
