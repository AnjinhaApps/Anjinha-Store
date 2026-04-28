require("dotenv").config();

const fs = require("fs");
const {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel]
});

const DB_FILE = "./database.json";

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify(
        {
          products: {},
          carts: {},
          coupons: {},
          guildConfigs: {}
        },
        null,
        2
      )
    );
  }

  const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));

  if (!db.products) db.products = {};
  if (!db.carts) db.carts = {};
  if (!db.coupons) db.coupons = {};
  if (!db.guildConfigs) db.guildConfigs = {};

  saveDB(db);
  return db;
}

function generateId() {
  return Math.random().toString(16).slice(2, 14).toUpperCase();
}

function formatMoney(value) {
  return `R$ ${Number(value).toFixed(2).replace(".", ",")}`;
}

function sanitizeChannelName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/gi, "-")
    .replace(/-+/g, "-")
    .slice(0, 20);
}

function parseColor(color) {
  if (!color) return 0xf1c40f;

  const clean = color.replace("#", "");

  if (!/^[0-9A-Fa-f]{6}$/.test(clean)) return 0xf1c40f;

  return parseInt(clean, 16);
}

function getGuildConfig(guildId) {
  const db = loadDB();

  if (!db.guildConfigs[guildId]) {
    db.guildConfigs[guildId] = {
      storeName: "Holy Store",
      mainColor: "#F1C40F",
      adminRoleId: process.env.ADMIN_ROLE_ID || null,
      deliveryChannelId: process.env.DELIVERY_CHANNEL_ID || null,
      pixKey: process.env.PIX_KEY || null,
      cartCategoryId: null
    };

    saveDB(db);
  }

  return db.guildConfigs[guildId];
}

function updateGuildConfig(guildId, data) {
  const db = loadDB();

  if (!db.guildConfigs[guildId]) {
    db.guildConfigs[guildId] = {
      storeName: "Holy Store",
      mainColor: "#F1C40F",
      adminRoleId: process.env.ADMIN_ROLE_ID || null,
      deliveryChannelId: process.env.DELIVERY_CHANNEL_ID || null,
      pixKey: process.env.PIX_KEY || null,
      cartCategoryId: null
    };
  }

  db.guildConfigs[guildId] = {
    ...db.guildConfigs[guildId],
    ...data
  };

  saveDB(db);
  return db.guildConfigs[guildId];
}

function getConfigColor(guildId) {
  const config = getGuildConfig(guildId);
  return parseColor(config.mainColor || "#F1C40F");
}

function isAdmin(member) {
  if (!member) return false;

  const config = getGuildConfig(member.guild.id);
  const adminRoleId = config.adminRoleId || process.env.ADMIN_ROLE_ID;

  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    member.permissions.has(PermissionsBitField.Flags.ManageGuild) ||
    (adminRoleId && member.roles.cache.has(adminRoleId))
  );
}

function isConfigured(guildId) {
  const config = getGuildConfig(guildId);

  return Boolean(
    (config.adminRoleId || process.env.ADMIN_ROLE_ID) &&
      (config.deliveryChannelId || process.env.DELIVERY_CHANNEL_ID) &&
      (config.pixKey || process.env.PIX_KEY)
  );
}

async function sendConfigPanel(interaction) {
  const config = getGuildConfig(interaction.guild.id);

  const embed = new EmbedBuilder()
    .setColor(getConfigColor(interaction.guild.id))
    .setTitle("Painel de Configuração")
    .setDescription(
      "Configure as principais informações do bot neste servidor.\n\n" +
        `**Nome da loja:** ${config.storeName || "Não configurado"}\n` +
        `**Cor principal:** ${config.mainColor || "Não configurado"}\n` +
        `**Cargo admin:** ${
          config.adminRoleId ? `<@&${config.adminRoleId}>` : "Não configurado"
        }\n` +
        `**Canal de entregas:** ${
          config.deliveryChannelId
            ? `<#${config.deliveryChannelId}>`
            : "Não configurado"
        }\n` +
        `**Categoria dos carrinhos:** ${
          config.cartCategoryId ? `<#${config.cartCategoryId}>` : "Automática"
        }\n` +
        `**Chave Pix:** ${config.pixKey ? `\`${config.pixKey}\`` : "Não configurada"}`
    )
    .setFooter({ text: "Sistema de configuração" })
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("config_loja")
      .setLabel("Configurar loja")
      .setEmoji("🏪")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("config_canais")
      .setLabel("Configurar canais")
      .setEmoji("📁")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("config_pagamento")
      .setLabel("Configurar pagamento")
      .setEmoji("💸")
      .setStyle(ButtonStyle.Success)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("config_verificar")
      .setLabel("Verificar configuração")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Secondary)
  );

  return interaction.reply({
    embeds: [embed],
    components: [row1, row2],
    ephemeral: true
  });
}

async function getOrCreateCart(interaction, db) {
  const guild = interaction.guild;
  const user = interaction.user;
  const config = getGuildConfig(guild.id);
  const adminRoleId = config.adminRoleId || process.env.ADMIN_ROLE_ID;

  let cart = Object.values(db.carts).find(
    (c) => c.userId === user.id && c.status === "open"
  );

  if (cart) {
    const oldChannel = guild.channels.cache.get(cart.channelId);
    if (oldChannel) return { cart, channel: oldChannel };
  }

  let category = null;

  if (config.cartCategoryId) {
    category = guild.channels.cache.get(config.cartCategoryId);
  }

  if (!category || category.type !== ChannelType.GuildCategory) {
    category = guild.channels.cache.find(
      (c) => c.name === "🛒・carrinhos" && c.type === ChannelType.GuildCategory
    );
  }

  if (!category) {
    category = await guild.channels.create({
      name: "🛒・carrinhos",
      type: ChannelType.GuildCategory
    });
  }

  updateGuildConfig(guild.id, {
    cartCategoryId: category.id
  });

  const permissionOverwrites = [
    {
      id: guild.id,
      deny: [PermissionsBitField.Flags.ViewChannel]
    },
    {
      id: user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    },
    {
      id: client.user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ManageChannels,
        PermissionsBitField.Flags.EmbedLinks,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    }
  ];

  if (adminRoleId) {
    permissionOverwrites.push({
      id: adminRoleId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageChannels
      ]
    });
  }

  const channel = await guild.channels.create({
    name: `carrinho-${sanitizeChannelName(user.username)}`,
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites
  });

  cart = {
    id: generateId(),
    userId: user.id,
    guildId: guild.id,
    channelId: channel.id,
    items: [],
    discount: 0,
    couponCode: null,
    status: "open",
    cartMessageId: null,
    createdAt: Date.now()
  };

  db.carts[cart.id] = cart;
  saveDB(db);

  await channel.send({
    content: `<@${user.id}>`,
    embeds: [
      new EmbedBuilder()
        .setColor(getConfigColor(guild.id))
        .setTitle("Carrinho criado")
        .setDescription(
          "Este é o seu carrinho exclusivo.\nAdicione produtos, vá para o pagamento ou delete o carrinho caso tenha aberto por engano."
        )
    ]
  });

  return { cart, channel };
}

async function renderCart(channel, cart) {
  const subtotal = cart.items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  const discountValue = subtotal * cart.discount;
  const total = subtotal - discountValue;

  const productsText =
    cart.items.length === 0
      ? "Nenhum produto no carrinho."
      : cart.items
          .map(
            (item) =>
              `**${item.quantity}x ${item.name}**\nPreço: ${formatMoney(
                item.price
              )} | Total: ${formatMoney(item.price * item.quantity)}`
          )
          .join("\n\n");

  const embed = new EmbedBuilder()
    .setColor(getConfigColor(channel.guild.id))
    .setTitle("Resumo de compras")
    .setDescription(productsText)
    .addFields(
      {
        name: "🛒 Subtotal",
        value: formatMoney(subtotal),
        inline: true
      },
      {
        name: "🏷️ Desconto",
        value:
          cart.discount > 0
            ? `${Math.round(cart.discount * 100)}% ${
                cart.couponCode ? `(${cart.couponCode})` : ""
              }`
            : "0",
        inline: true
      },
      {
        name: "💰 Total",
        value: formatMoney(total),
        inline: true
      }
    )
    .setFooter({ text: `Identificador: ${cart.id}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pay_${cart.id}`)
      .setLabel("Ir para o pagamento")
      .setEmoji("💸")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(`coupon_${cart.id}`)
      .setLabel("Aplicar cupom")
      .setEmoji("🏷️")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId(`delete_${cart.id}`)
      .setLabel("Deletar carrinho")
      .setEmoji("⚠️")
      .setStyle(ButtonStyle.Danger)
  );

  if (cart.cartMessageId) {
    try {
      const oldMessage = await channel.messages.fetch(cart.cartMessageId);
      await oldMessage.edit({ embeds: [embed], components: [row] });
      return;
    } catch {}
  }

  const msg = await channel.send({
    embeds: [embed],
    components: [row]
  });

  const db = loadDB();

  if (db.carts[cart.id]) {
    db.carts[cart.id].cartMessageId = msg.id;
    saveDB(db);
  }
}

async function sendProductMessage(interaction, product) {
  const embed = new EmbedBuilder()
    .setColor(product.color)
    .setTitle(product.title)
    .setDescription(product.description)
    .addFields(
      {
        name: "🌎 Produto",
        value: product.name,
        inline: true
      },
      {
        name: "💸 Preço",
        value: formatMoney(product.price),
        inline: true
      },
      {
        name: "📦 Estoque",
        value: String(product.stock),
        inline: true
      }
    )
    .setFooter({
      text: product.footer || "Holy Store - Todos os direitos reservados"
    });

  if (product.image) {
    embed.setImage(product.image);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`addcart_${product.id}`)
      .setLabel("Adicionar ao carrinho")
      .setEmoji("🛍️")
      .setStyle(ButtonStyle.Success)
  );

  await interaction.channel.send({
    embeds: [embed],
    components: [row]
  });
}

client.once("ready", async () => {
  console.log(`✅ Bot online como ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName("painel")
      .setDescription("Abre o painel de configuração do bot.")
      .toJSON(),

    new SlashCommandBuilder()
      .setName("addproduto")
      .setDescription("Cria uma mensagem de produto personalizada.")
      .addStringOption((option) =>
        option
          .setName("titulo")
          .setDescription("Título da embed do produto.")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("produto")
          .setDescription("Nome do produto.")
          .setRequired(true)
      )
      .addNumberOption((option) =>
        option
          .setName("preco")
          .setDescription("Preço do produto. Exemplo: 15")
          .setRequired(true)
      )
      .addIntegerOption((option) =>
        option
          .setName("estoque")
          .setDescription("Estoque do produto.")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("descricao")
          .setDescription("Descrição do produto.")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("imagem")
          .setDescription("Link da imagem/banner do produto.")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("emoji")
          .setDescription("Emoji do produto. Exemplo: 🚀")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("cor")
          .setDescription("Cor em hexadecimal. Exemplo: #F1C40F")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("rodape")
          .setDescription("Texto do rodapé da embed.")
          .setRequired(false)
      )
      .toJSON(),

    new SlashCommandBuilder()
      .setName("addcupom")
      .setDescription("Cria um cupom de desconto personalizado.")
      .addStringOption((option) =>
        option
          .setName("codigo")
          .setDescription("Código do cupom. Exemplo: BOOSTER26")
          .setRequired(true)
      )
      .addNumberOption((option) =>
        option
          .setName("desconto")
          .setDescription("Porcentagem de desconto. Exemplo: 15")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("titulo")
          .setDescription("Título da mensagem do cupom.")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("descricao")
          .setDescription("Descrição personalizada do cupom.")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("cor")
          .setDescription("Cor em hexadecimal. Exemplo: #F1C40F")
          .setRequired(false)
      )
      .toJSON()
  ];

  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.commands.set(commands);
      console.log(`✅ Comandos registrados em: ${guild.name}`);
    } catch (error) {
      console.log(`❌ Erro ao registrar comandos em: ${guild.name}`);
      console.error(error);
    }
  }

  console.log("✅ Registro de comandos finalizado.");
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "painel") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.reply({
            content: "❌ Apenas administradores podem abrir o painel.",
            ephemeral: true
          });
        }

        return sendConfigPanel(interaction);
      }

      if (interaction.commandName === "addproduto") {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({
            content: "❌ Apenas administradores podem adicionar produtos.",
            ephemeral: true
          });
        }

        if (!isConfigured(interaction.guild.id)) {
          return interaction.reply({
            content: "❌ Configure o bot primeiro usando `/painel`.",
            ephemeral: true
          });
        }

        const title = interaction.options.getString("titulo");
        const name = interaction.options.getString("produto");
        const price = interaction.options.getNumber("preco");
        const stock = interaction.options.getInteger("estoque");
        const description = interaction.options.getString("descricao");
        const image = interaction.options.getString("imagem");
        const emoji = interaction.options.getString("emoji") || "🛍️";
        const color = parseColor(interaction.options.getString("cor"));
        const footer =
          interaction.options.getString("rodape") ||
          `${getGuildConfig(interaction.guild.id).storeName} - Todos os direitos reservados`;

        if (price <= 0) {
          return interaction.reply({
            content: "❌ O preço precisa ser maior que 0.",
            ephemeral: true
          });
        }

        if (stock < 0) {
          return interaction.reply({
            content: "❌ O estoque não pode ser negativo.",
            ephemeral: true
          });
        }

        const db = loadDB();

        const product = {
          id: generateId(),
          guildId: interaction.guild.id,
          title,
          name,
          price,
          stock,
          description,
          image,
          emoji,
          color,
          footer,
          createdAt: Date.now()
        };

        db.products[product.id] = product;
        saveDB(db);

        await sendProductMessage(interaction, product);

        return interaction.reply({
          content: "✅ Produto criado e enviado com sucesso.",
          ephemeral: true
        });
      }

      if (interaction.commandName === "addcupom") {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({
            content: "❌ Apenas administradores podem criar cupons.",
            ephemeral: true
          });
        }

        if (!isConfigured(interaction.guild.id)) {
          return interaction.reply({
            content: "❌ Configure o bot primeiro usando `/painel`.",
            ephemeral: true
          });
        }

        const code = interaction.options
          .getString("codigo")
          .trim()
          .toUpperCase()
          .replace(/\s+/g, "");

        const discount = interaction.options.getNumber("desconto");
        const title =
          interaction.options.getString("titulo") || "Cupom de desconto criado";
        const description =
          interaction.options.getString("descricao") ||
          "Use este cupom no carrinho para receber desconto na sua compra.";
        const color = parseColor(interaction.options.getString("cor"));

        if (!/^[A-Z0-9_-]{3,20}$/.test(code)) {
          return interaction.reply({
            content:
              "❌ Código inválido. Use apenas letras, números, _ ou -. Exemplo: BOOSTER26",
            ephemeral: true
          });
        }

        if (discount <= 0 || discount > 90) {
          return interaction.reply({
            content: "❌ O desconto precisa ser maior que 0 e no máximo 90%.",
            ephemeral: true
          });
        }

        const db = loadDB();

        db.coupons[`${interaction.guild.id}_${code}`] = {
          code,
          guildId: interaction.guild.id,
          discount,
          createdBy: interaction.user.id,
          createdAt: Date.now(),
          active: true
        };

        saveDB(db);

        const embed = new EmbedBuilder()
          .setColor(color)
          .setTitle(title)
          .setDescription(
            `${description}\n\n` +
              `🏷️ **Código:** \`${code}\`\n` +
              `💸 **Desconto:** ${discount}%\n\n` +
              "Para usar, abra seu carrinho, clique em **Aplicar cupom** e digite o código acima."
          )
          .setFooter({ text: `${getGuildConfig(interaction.guild.id).storeName} - Sistema de Cupons` })
          .setTimestamp();

        await interaction.channel.send({
          embeds: [embed]
        });

        return interaction.reply({
          content: `✅ Cupom \`${code}\` criado com ${discount}% de desconto.`,
          ephemeral: true
        });
      }
    }

    if (interaction.isButton()) {
      const db = loadDB();

      if (interaction.customId === "config_loja") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.reply({
            content: "❌ Apenas administradores podem configurar a loja.",
            ephemeral: true
          });
        }

        const config = getGuildConfig(interaction.guild.id);

        const modal = new ModalBuilder()
          .setCustomId("modal_config_loja")
          .setTitle("Configurar loja");

        const storeNameInput = new TextInputBuilder()
          .setCustomId("store_name")
          .setLabel("Nome da loja")
          .setPlaceholder("Exemplo: Holy Store")
          .setValue(config.storeName || "Holy Store")
          .setRequired(true)
          .setStyle(TextInputStyle.Short);

        const colorInput = new TextInputBuilder()
          .setCustomId("main_color")
          .setLabel("Cor principal em HEX")
          .setPlaceholder("Exemplo: #F1C40F")
          .setValue(config.mainColor || "#F1C40F")
          .setRequired(true)
          .setStyle(TextInputStyle.Short);

        modal.addComponents(
          new ActionRowBuilder().addComponents(storeNameInput),
          new ActionRowBuilder().addComponents(colorInput)
        );

        return interaction.showModal(modal);
      }

      if (interaction.customId === "config_canais") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.reply({
            content: "❌ Apenas administradores podem configurar os canais.",
            ephemeral: true
          });
        }

        const config = getGuildConfig(interaction.guild.id);

        const modal = new ModalBuilder()
          .setCustomId("modal_config_canais")
          .setTitle("Configurar canais");

        const adminRoleInput = new TextInputBuilder()
          .setCustomId("admin_role_id")
          .setLabel("ID do cargo admin")
          .setPlaceholder("Exemplo: 123456789012345678")
          .setValue(config.adminRoleId || "")
          .setRequired(true)
          .setStyle(TextInputStyle.Short);

        const deliveryInput = new TextInputBuilder()
          .setCustomId("delivery_channel_id")
          .setLabel("ID do canal de entregas")
          .setPlaceholder("Exemplo: 123456789012345678")
          .setValue(config.deliveryChannelId || "")
          .setRequired(true)
          .setStyle(TextInputStyle.Short);

        const categoryInput = new TextInputBuilder()
          .setCustomId("cart_category_id")
          .setLabel("ID da categoria carrinhos")
          .setPlaceholder("Pode deixar vazio se quiser automático")
          .setValue(config.cartCategoryId || "")
          .setRequired(false)
          .setStyle(TextInputStyle.Short);

        modal.addComponents(
          new ActionRowBuilder().addComponents(adminRoleInput),
          new ActionRowBuilder().addComponents(deliveryInput),
          new ActionRowBuilder().addComponents(categoryInput)
        );

        return interaction.showModal(modal);
      }

      if (interaction.customId === "config_pagamento") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.reply({
            content: "❌ Apenas administradores podem configurar o pagamento.",
            ephemeral: true
          });
        }

        const config = getGuildConfig(interaction.guild.id);

        const modal = new ModalBuilder()
          .setCustomId("modal_config_pagamento")
          .setTitle("Configurar pagamento");

        const pixInput = new TextInputBuilder()
          .setCustomId("pix_key")
          .setLabel("Chave Pix")
          .setPlaceholder("Digite sua chave Pix")
          .setValue(config.pixKey || "")
          .setRequired(true)
          .setStyle(TextInputStyle.Short);

        modal.addComponents(new ActionRowBuilder().addComponents(pixInput));

        return interaction.showModal(modal);
      }

      if (interaction.customId === "config_verificar") {
        const config = getGuildConfig(interaction.guild.id);

        const embed = new EmbedBuilder()
          .setColor(isConfigured(interaction.guild.id) ? 0x2ecc71 : 0xe74c3c)
          .setTitle("Verificação da configuração")
          .setDescription(
            `${config.storeName ? "✅" : "❌"} Nome da loja\n` +
              `${config.mainColor ? "✅" : "❌"} Cor principal\n` +
              `${config.adminRoleId ? "✅" : "❌"} Cargo admin\n` +
              `${config.deliveryChannelId ? "✅" : "❌"} Canal de entregas\n` +
              `${config.pixKey ? "✅" : "❌"} Chave Pix\n` +
              `${config.cartCategoryId ? "✅" : "⚠️"} Categoria dos carrinhos\n\n` +
              (isConfigured(interaction.guild.id)
                ? "✅ O bot está configurado corretamente."
                : "⚠️ Ainda falta alguma informação obrigatória.")
          );

        return interaction.reply({
          embeds: [embed],
          ephemeral: true
        });
      }

      if (interaction.customId.startsWith("addcart_")) {
        if (!isConfigured(interaction.guild.id)) {
          return interaction.reply({
            content: "❌ Este servidor ainda não foi configurado. Use `/painel` primeiro.",
            ephemeral: true
          });
        }

        const productId = interaction.customId.replace("addcart_", "");
        const product = db.products[productId];

        if (!product) {
          return interaction.reply({
            content: "❌ Produto não encontrado.",
            ephemeral: true
          });
        }

        if (product.guildId && product.guildId !== interaction.guild.id) {
          return interaction.reply({
            content: "❌ Este produto não pertence a este servidor.",
            ephemeral: true
          });
        }

        if (product.stock <= 0) {
          return interaction.reply({
            content: "❌ Este produto está sem estoque.",
            ephemeral: true
          });
        }

        const { cart, channel } = await getOrCreateCart(interaction, db);

        const existing = cart.items.find((item) => item.id === product.id);

        if (existing) {
          existing.quantity += 1;
        } else {
          cart.items.push({
            id: product.id,
            name: product.name,
            price: product.price,
            quantity: 1
          });
        }

        db.carts[cart.id] = cart;
        saveDB(db);

        await renderCart(channel, cart);

        return interaction.reply({
          content: `✅ Produto adicionado ao carrinho: ${channel}`,
          ephemeral: true
        });
      }

      if (interaction.customId.startsWith("delete_")) {
        const cartId = interaction.customId.replace("delete_", "");
        const cart = db.carts[cartId];

        if (!cart) {
          return interaction.reply({
            content: "❌ Carrinho não encontrado.",
            ephemeral: true
          });
        }

        if (interaction.user.id !== cart.userId && !isAdmin(interaction.member)) {
          return interaction.reply({
            content: "❌ Você não pode deletar este carrinho.",
            ephemeral: true
          });
        }

        cart.status = "deleted";
        saveDB(db);

        await interaction.reply({
          content: "🗑️ Carrinho será deletado em 5 segundos."
        });

        setTimeout(async () => {
          try {
            await interaction.channel.delete();
          } catch {}
        }, 5000);
      }

      if (interaction.customId.startsWith("coupon_")) {
        const cartId = interaction.customId.replace("coupon_", "");

        const modal = new ModalBuilder()
          .setCustomId(`coupon_modal_${cartId}`)
          .setTitle("Aplicar cupom");

        const input = new TextInputBuilder()
          .setCustomId("coupon_code")
          .setLabel("Digite o cupom")
          .setPlaceholder("Exemplo: BOOSTER26")
          .setRequired(true)
          .setStyle(TextInputStyle.Short);

        modal.addComponents(new ActionRowBuilder().addComponents(input));

        return interaction.showModal(modal);
      }

      if (interaction.customId.startsWith("pay_")) {
        const cartId = interaction.customId.replace("pay_", "");
        const cart = db.carts[cartId];

        if (!cart) {
          return interaction.reply({
            content: "❌ Carrinho não encontrado.",
            ephemeral: true
          });
        }

        if (interaction.user.id !== cart.userId) {
          return interaction.reply({
            content: "❌ Apenas o dono do carrinho pode ir para o pagamento.",
            ephemeral: true
          });
        }

        if (cart.items.length === 0) {
          return interaction.reply({
            content: "❌ Seu carrinho está vazio.",
            ephemeral: true
          });
        }

        const config = getGuildConfig(interaction.guild.id);
        const pixKey = config.pixKey || process.env.PIX_KEY;

        const subtotal = cart.items.reduce(
          (sum, item) => sum + item.price * item.quantity,
          0
        );

        const total = subtotal - subtotal * cart.discount;

        const embed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle("Pagamento")
          .setDescription(
            `💸 **Valor total:** ${formatMoney(total)}\n\n` +
              `🔑 **Chave Pix:**\n\`${pixKey}\`\n\n` +
              "Após pagar, envie o comprovante neste carrinho e clique em **Já paguei**."
          )
          .setFooter({ text: `Carrinho: ${cart.id}` });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`paid_${cart.id}`)
            .setLabel("Já paguei")
            .setEmoji("✅")
            .setStyle(ButtonStyle.Success)
        );

        return interaction.reply({
          embeds: [embed],
          components: [row]
        });
      }

      if (interaction.customId.startsWith("paid_")) {
        const cartId = interaction.customId.replace("paid_", "");
        const cart = db.carts[cartId];

        if (!cart) {
          return interaction.reply({
            content: "❌ Carrinho não encontrado.",
            ephemeral: true
          });
        }

        if (interaction.user.id !== cart.userId) {
          return interaction.reply({
            content: "❌ Apenas o dono do carrinho pode confirmar o pagamento.",
            ephemeral: true
          });
        }

        const config = getGuildConfig(interaction.guild.id);
        const adminRoleId = config.adminRoleId || process.env.ADMIN_ROLE_ID;

        const embed = new EmbedBuilder()
          .setColor(getConfigColor(interaction.guild.id))
          .setTitle("Pagamento aguardando aprovação")
          .setDescription(
            `<@${cart.userId}> informou que realizou o pagamento.\n\n` +
              "A equipe deve conferir o comprovante e aprovar ou recusar abaixo."
          )
          .setFooter({ text: `Carrinho: ${cart.id}` })
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`approve_${cart.id}`)
            .setLabel("Aprovar pagamento")
            .setEmoji("✅")
            .setStyle(ButtonStyle.Success),

          new ButtonBuilder()
            .setCustomId(`reject_${cart.id}`)
            .setLabel("Recusar pagamento")
            .setEmoji("❌")
            .setStyle(ButtonStyle.Danger)
        );

        return interaction.reply({
          content: adminRoleId ? `<@&${adminRoleId}>` : "Equipe",
          embeds: [embed],
          components: [row]
        });
      }

      if (interaction.customId.startsWith("approve_")) {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({
            content: "❌ Apenas administradores podem aprovar pagamentos.",
            ephemeral: true
          });
        }

        const cartId = interaction.customId.replace("approve_", "");
        const cart = db.carts[cartId];

        if (!cart) {
          return interaction.reply({
            content: "❌ Carrinho não encontrado.",
            ephemeral: true
          });
        }

        cart.status = "approved";
        cart.approvedAt = Date.now();

        const subtotal = cart.items.reduce(
          (sum, item) => sum + item.price * item.quantity,
          0
        );

        const discountValue = subtotal * cart.discount;
        const total = subtotal - discountValue;

        for (const item of cart.items) {
          if (db.products[item.id]) {
            db.products[item.id].stock = Math.max(
              0,
              db.products[item.id].stock - item.quantity
            );
          }
        }

        saveDB(db);

        const productsText = cart.items
          .map(
            (item, index) =>
              `${index + 1} - ${item.name} x${item.quantity} - ${formatMoney(
                item.price * item.quantity
              )}`
          )
          .join("\n");

        const approvedEmbed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle("COMPRA APROVADA")
          .setDescription(
            `👤 **Comprador:** <@${cart.userId}>\n` +
              `💰 **Valor pago:** ${formatMoney(total)}\n` +
              `🏷️ **Valor do desconto:** ${formatMoney(discountValue)}\n` +
              `🎟️ **Cupom usado:** ${cart.couponCode || "Nenhum"}\n` +
              `📆 **Data do carrinho:** <t:${Math.floor(cart.createdAt / 1000)}:f>\n` +
              `✅ **Data aprovado:** <t:${Math.floor(Date.now() / 1000)}:f>\n` +
              `🆔 **Identificador:** ${cart.id}\n` +
              `⭐ **Avaliação:** 5 estrelas\n\n` +
              `**PRODUTOS**\n${productsText}`
          );

        await interaction.update({
          content: "✅ Pagamento aprovado com sucesso.",
          embeds: [approvedEmbed],
          components: []
        });

        const config = getGuildConfig(interaction.guild.id);
        const deliveryChannelId =
          config.deliveryChannelId || process.env.DELIVERY_CHANNEL_ID;

        const deliveryChannel = interaction.guild.channels.cache.get(deliveryChannelId);

        if (deliveryChannel) {
          await deliveryChannel.send({
            content: `<@${cart.userId}>`,
            embeds: [approvedEmbed]
          });
        }

        try {
          const user = await client.users.fetch(cart.userId);
          await user.send(
            "✅ Sua compra foi aprovada. Aguarde a entrega pelo servidor."
          );
        } catch {}
      }

      if (interaction.customId.startsWith("reject_")) {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({
            content: "❌ Apenas administradores podem recusar pagamentos.",
            ephemeral: true
          });
        }

        const cartId = interaction.customId.replace("reject_", "");
        const cart = db.carts[cartId];

        if (!cart) {
          return interaction.reply({
            content: "❌ Carrinho não encontrado.",
            ephemeral: true
          });
        }

        cart.status = "rejected";
        saveDB(db);

        return interaction.update({
          content: "❌ Pagamento recusado. Confira o comprovante com a equipe.",
          embeds: [],
          components: []
        });
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === "modal_config_loja") {
        const storeName = interaction.fields.getTextInputValue("store_name").trim();
        const mainColor = interaction.fields.getTextInputValue("main_color").trim();

        if (!/^#[0-9A-Fa-f]{6}$/.test(mainColor)) {
          return interaction.reply({
            content: "❌ Cor inválida. Use o formato HEX. Exemplo: #F1C40F",
            ephemeral: true
          });
        }

        updateGuildConfig(interaction.guild.id, {
          storeName,
          mainColor
        });

        return interaction.reply({
          content: "✅ Configuração da loja salva com sucesso.",
          ephemeral: true
        });
      }

      if (interaction.customId === "modal_config_canais") {
        const adminRoleId = interaction.fields
          .getTextInputValue("admin_role_id")
          .trim();

        const deliveryChannelId = interaction.fields
          .getTextInputValue("delivery_channel_id")
          .trim();

        const cartCategoryId = interaction.fields
          .getTextInputValue("cart_category_id")
          .trim();

        const role = interaction.guild.roles.cache.get(adminRoleId);
        const deliveryChannel = interaction.guild.channels.cache.get(deliveryChannelId);

        if (!role) {
          return interaction.reply({
            content: "❌ Cargo admin não encontrado. Confira o ID.",
            ephemeral: true
          });
        }

        if (!deliveryChannel || deliveryChannel.type !== ChannelType.GuildText) {
          return interaction.reply({
            content: "❌ Canal de entregas inválido. Use o ID de um canal de texto.",
            ephemeral: true
          });
        }

        if (cartCategoryId) {
          const category = interaction.guild.channels.cache.get(cartCategoryId);

          if (!category || category.type !== ChannelType.GuildCategory) {
            return interaction.reply({
              content: "❌ Categoria inválida. Use o ID de uma categoria ou deixe vazio.",
              ephemeral: true
            });
          }
        }

        updateGuildConfig(interaction.guild.id, {
          adminRoleId,
          deliveryChannelId,
          cartCategoryId: cartCategoryId || null
        });

        return interaction.reply({
          content: "✅ Canais e cargo admin configurados com sucesso.",
          ephemeral: true
        });
      }

      if (interaction.customId === "modal_config_pagamento") {
        const pixKey = interaction.fields.getTextInputValue("pix_key").trim();

        if (pixKey.length < 3) {
          return interaction.reply({
            content: "❌ Chave Pix inválida.",
            ephemeral: true
          });
        }

        updateGuildConfig(interaction.guild.id, {
          pixKey
        });

        return interaction.reply({
          content: "✅ Pagamento configurado com sucesso.",
          ephemeral: true
        });
      }

      if (!interaction.customId.startsWith("coupon_modal_")) return;

      const cartId = interaction.customId.replace("coupon_modal_", "");
      const coupon = interaction.fields
        .getTextInputValue("coupon_code")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");

      const db = loadDB();
      const cart = db.carts[cartId];

      if (!cart) {
        return interaction.reply({
          content: "❌ Carrinho não encontrado.",
          ephemeral: true
        });
      }

      if (interaction.user.id !== cart.userId) {
        return interaction.reply({
          content: "❌ Apenas o dono do carrinho pode aplicar cupom.",
          ephemeral: true
        });
      }

      const couponData =
        db.coupons[`${interaction.guild.id}_${coupon}`] || db.coupons[coupon];

      if (!couponData || couponData.active !== true) {
        return interaction.reply({
          content: "❌ Cupom inválido ou desativado.",
          ephemeral: true
        });
      }

      cart.discount = couponData.discount / 100;
      cart.couponCode = couponData.code;

      db.carts[cart.id] = cart;
      saveDB(db);

      await renderCart(interaction.channel, cart);

      return interaction.reply({
        content: `✅ Cupom aplicado: ${couponData.code} — ${couponData.discount}% de desconto.`,
        ephemeral: true
      });
    }
  } catch (error) {
    console.error(error);

    const msg =
      "❌ Ocorreu um erro. Confira se o bot tem permissões de Administrador, Gerenciar Canais, Ver Canais, Enviar Mensagens e Incorporar Links.";

    if (interaction.replied || interaction.deferred) {
      return interaction.followUp({ content: msg, ephemeral: true });
    }

    return interaction.reply({ content: msg, ephemeral: true });
  }
});

client.login(process.env.TOKEN);
