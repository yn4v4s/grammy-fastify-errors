require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const { Bot, BotError, session, webhookCallback } = require("grammy");
const {
  conversations,
  createConversation,
} = require("@grammyjs/conversations");
const { PrismaAdapter } = require("@grammyjs/storage-prisma");
const { run } = require("@grammyjs/runner");

const Fastify = require("fastify");
const ngrok = require("ngrok");

const prisma = new PrismaClient();
const bot = new Bot(process.env.BOT_TOKEN);

bot.use(
  session({ initial: () => ({}), storage: new PrismaAdapter(prisma.session) })
);

const convo = async (conversation, ctx) => {
  await ctx.reply("Yo, click any button!");

  const {
    callbackQuery: { data },
  } = await conversation.waitFor("callback_query:data", () => {
    // This doesn't kill the convo, regardless of using webhooks, runner or bot.start()
    throw new Error("Told ya man!");
  });

  console.log(data);

  await ctx.reply("Bye!");
};

bot.use(conversations());
bot.use(createConversation(convo));

bot.command("convo", (ctx) => ctx.conversation.enter("convo"));

const _run = async () => {
  try {
    let server;
    let runner;

    await prisma.$connect();

    if (process.env.USE_WEBHOOK === "true") {
      server = Fastify();

      server.setErrorHandler(async (err, _, reply) => {
        if (err instanceof BotError) {
          console.error(err.message);
          await err.ctx.reply("Something went wrong!");
          return reply.send({});
        } else {
          console.error(err);
          return reply
            .status(500)
            .send({ OK: false, message: "Something went wrong!" });
        }
      });

      server.get("/", (_, reply) => reply.send("Send me some updates!"));

      server.post("/", webhookCallback(bot, "fastify"));

      await server.listen({
        host: "127.0.0.1",
        port: 8080,
      });

      const hookUrl = await ngrok.connect({
        addr: 8080,
      });

      await bot.api.setWebhook(hookUrl, { drop_pending_updates: true });
    } else {
      bot.catch((err) => {
        console.error(err.message);
        return err.ctx.reply("Something went wrong!");
      });
      if (process.env.USE_RUNNER === "true") runner = run(bot);
      else await bot.start();
    }

    prisma.$on("beforeExit", async () => {
      if (server?.addresses().length) {
        await bot.api.deleteWebhook();
        await server.close();
        process.exit(0);
      } else {
        if (runner?.isRunning()) await runner.stop();
        else await bot.stop();
      }
    });
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
};

void _run();
