import mongoose from "mongoose";

export const projectSchema = new mongoose.Schema({
	projectId: String,
	createdAt: { type: Date, default: Date.now },
	zipFileId: mongoose.Schema.Types.ObjectId,
	size: Number,
});

export const Project = mongoose.model("Project", projectSchema);
