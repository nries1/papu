"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const bookYoga_1 = require("./bookYoga");
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.post('/book-yoga', async (req, res) => {
    const { date, className, preferredTime } = req.body;
    if (!date || !className) {
        res.status(400).json({ error: 'date and className are required' });
        return;
    }
    try {
        const message = await (0, bookYoga_1.bookYogaClass)(date, className, preferredTime);
        res.json({ success: true, message });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ success: false, message });
    }
});
app.get('/health', (_req, res) => res.json({ ok: true }));
const port = process.env.PORT ?? 3001;
app.listen(port, () => console.log(`web-agent listening on :${port}`));
