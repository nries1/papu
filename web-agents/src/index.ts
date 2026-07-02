import express from 'express';
import { bookYogaClass } from './mindbody/y7/bookYoga';

const app = express();
app.use(express.json());

app.post('/book-yoga', async (req, res) => {
  const { date, className, preferredTime } = req.body as {
    date: string;
    className: string;
    preferredTime?: string;
  };

  if (!date || !className) {
    res.status(400).json({ error: 'date and className are required' });
    return;
  }

  try {
    const message = await bookYogaClass(date, className, preferredTime);
    res.json({ success: true, message });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

const port = process.env.WEB_AGENT_PORT ?? process.env.PORT ?? 3001;
app.listen(port, () => console.log(`web-agent listening on :${port}`));
