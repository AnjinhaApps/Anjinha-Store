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
  SlashCommandBuilder,
  ChannelSelectMenuBuilder,
  StringSelectMenuBuilder
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers
  ],
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
          guildConfigs: {},
          apPanels: {}
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
  if (!db.apPanels) db.apPanels = {};

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

function defaultGuildConfig() {
  return {
    storeName: "Angel' Store",
    mainColor: "#9b59b6",
    adminRoleId: process.env.ADMIN_ROLE_ID || null,
    deliveryChannelId: process.env.DELIVERY_CHANNEL_ID || null,
    pixKey: process.env.PIX_KEY || null,
    cartCategoryId: null,
    inviteChannelId: null,
    welcomeChannelId: null,
    apPanel: {
      channelId: null,
      team: "1v1",
      device: "Mobile",
      minValue: 0.3,
      maxValue: 1,
      title: "Fila",
      message: "Clique em um botão para entrar na fila.",
      image: "",
      color: "#00ffff",
      fullLabel: "🔫 Full Ump Xm8",
      mobiladorLabel: "🧽 Mobilador",
      normalLabel: "📱 Normal",
      exitLabel: "➡️ Sair"
    }
  };
}

function getGuildConfig(guildId) {
  const db = loadDB();

  if (!db.guildConfigs[guildId]) {
    db.guildConfigs[guildId] = defaultGuildConfig();
    saveDB(db);
  }

  if (!db.guildConfigs[guildId].apPanel) {
    db.guildConfigs[guildId].apPanel = defaultGuildConfig().apPanel;
    saveDB(db);
  }

  return db.guildConfigs[guildId];
}

function updateGuildConfig(guildId, data) {
  const db = loadDB();

  if (!db.guildConfigs[guildId]) {
    db.guildConfigs[guildId] = defaultGuildConfig();
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

function buildProductEmbed(product) {
  const embed = new EmbedBuilder()
    .setColor(product.color || 0xf1c40f)
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
      },
      {
        name: "🆔 ID para editar",
        value: `\`${product.id}\``,
        inline: false
      }
    )
    .setFooter({
      text: product.footer || "Holy Store - Todos os direitos reservados"
    });

  if (product.image) {
    embed.setImage(product.image);
  }

  return embed;
}

function buildProductRow(productId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`addcart_${productId}`)
      .setLabel("Adicionar ao carrinho")
      .setEmoji("🛍️")
      .setStyle(ButtonStyle.Success)
  );
}

async function sendProductMessage(interaction, product) {
  const msg = await interaction.channel.send({
    embeds: [buildProductEmbed(product)],
    components: [buildProductRow(product.id)]
  });

  const db = loadDB();

  if (db.products[product.id]) {
    db.products[product.id].channelId = msg.channel.id;
    db.products[product.id].messageId = msg.id;
    saveDB(db);
  }

  return msg;
}

async function updateProductMessage(guild, product) {
  if (!product.channelId || !product.messageId) return false;

  try {
    const channel = await guild.channels.fetch(product.channelId);
    if (!channel || !channel.isTextBased()) return false;

    const message = await channel.messages.fetch(product.messageId);

    await message.edit({
      embeds: [buildProductEmbed(product)],
      components: [buildProductRow(product.id)]
    });

    return true;
  } catch {
    return false;
  }
}

function buildCouponEmbed(guildId, coupon) {
  const title = coupon.title || "Cupom de desconto criado";

  const description =
    coupon.description ||
    "Use este cupom no carrinho para receber desconto na sua compra.";

  return new EmbedBuilder()
    .setColor(coupon.color || getConfigColor(guildId))
    .setTitle(title)
    .setDescription(
      `${description}\n\n` +
        `🏷️ **Código:** \`${coupon.code}\`\n` +
        `💸 **Desconto:** ${coupon.discount}%\n` +
        `📌 **Status:** ${coupon.active ? "Ativo" : "Desativado"}\n\n` +
        "Para usar, abra seu carrinho, clique em **Aplicar cupom** e digite o código acima."
    )
    .setFooter({
      text: `${getGuildConfig(guildId).storeName} - Sistema de Cupons`
    })
    .setTimestamp();
}

async function updateCouponMessage(guild, coupon) {
  if (!coupon.channelId || !coupon.messageId) return false;

  try {
    const channel = await guild.channels.fetch(coupon.channelId);
    if (!channel || !channel.isTextBased()) return false;

    const message = await channel.messages.fetch(coupon.messageId);

    await message.edit({
      embeds: [buildCouponEmbed(guild.id, coupon)]
    });

    return true;
  } catch {
    return false;
  }
}


function getAPConfig(guildId) {
  const config = getGuildConfig(guildId);

  if (!config.apPanel) {
    config.apPanel = defaultGuildConfig().apPanel;
    updateGuildConfig(guildId, { apPanel: config.apPanel });
  }

  return config.apPanel;
}

function updateAPConfig(guildId, data) {
  const config = getGuildConfig(guildId);
  const current = config.apPanel || defaultGuildConfig().apPanel;

  return updateGuildConfig(guildId, {
    apPanel: {
      ...current,
      ...data
    }
  }).apPanel;
}

function formatAPMoney(value) {
  return `R$ ${Number(value).toFixed(2).replace(".", ",")}`;
}

function normalizeAPDevice(device) {
  const text = String(device || "Mobile").toLowerCase();
  if (text.includes("pc")) return "Pc";
  if (text.includes("misto")) return "Misto";
  return "Mobile";
}

function apDeviceEmoji(device) {
  const normalized = normalizeAPDevice(device);
  if (normalized === "Pc") return "💻";
  if (normalized === "Misto") return "🔄";
  return "📱";
}

function nextAPValue(value) {
  if (value < 1) return Math.round((value + 0.2) * 100) / 100;
  if (value < 10) return Math.round((value + 1) * 100) / 100;
  if (value < 50) return Math.round((value + 10) * 100) / 100;
  return Math.round((value + 50) * 100) / 100;
}

function generateAPValues(minValue, maxValue) {
  let min = Number(minValue);
  let max = Number(maxValue);

  if (!Number.isFinite(min) || min <= 0) min = 0.3;
  if (!Number.isFinite(max) || max < min) max = min;

  const values = [];
  let current = Math.round(min * 100) / 100;
  const limit = Math.round(max * 100) / 100;

  while (current <= limit + 0.0001 && values.length < 100) {
    values.push(Number(current.toFixed(2)));
    const next = nextAPValue(current);
    if (next <= current) break;
    current = next;
  }

  return values;
}

function buildAPPlayersText(panel) {
  const players = panel.players || {};
  const entries = Object.entries(players);

  if (entries.length === 0) return "Sem jogadores...";

  return entries
    .map(([userId, data]) => `<@${userId}> — **${data.choice}**`)
    .join("\n");
}

function buildAPEmbed(guildId, panel) {
  const config = getAPConfig(guildId);
  const device = normalizeAPDevice(panel.device || config.device);
  const team = panel.team || config.team;
  const title = panel.title || config.title || "Fila";
  const image = panel.image ?? config.image;
  const color = parseColor(panel.color || config.color || "#00ffff");

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${team} | ${title}`)
    .setDescription(
      `Formato: **${team} ${device}**\n` +
        `💰 Preço: **${formatAPMoney(panel.price)}**\n\n` +
        `👑 **Jogadores**\n${buildAPPlayersText(panel)}`
    )
    .setTimestamp();

  if (image) embed.setThumbnail(image);

  return embed;
}

function buildAPRows(guildId, panel) {
  const config = getAPConfig(guildId);
  const device = normalizeAPDevice(panel.device || config.device);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ap_join_normal")
      .setLabel(config.normalLabel || "Normal")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("ap_join_full")
      .setLabel(config.fullLabel || "Full Ump Xm8")
      .setStyle(ButtonStyle.Success)
  );

  if (device === "Mobile") {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId("ap_join_mobilador")
        .setLabel(config.mobiladorLabel || "Mobilador")
        .setStyle(ButtonStyle.Success)
    );
  }

  row.addComponents(
    new ButtonBuilder()
      .setCustomId("ap_leave")
      .setLabel(config.exitLabel || "Sair")
      .setStyle(ButtonStyle.Danger)
  );

  return [row];
}

async function updateAPMessage(guild, messageId) {
  const db = loadDB();
  const panel = db.apPanels[messageId];
  if (!panel) return false;

  try {
    const channel = await guild.channels.fetch(panel.channelId);
    if (!channel || !channel.isTextBased()) return false;

    const message = await channel.messages.fetch(messageId);

    await message.edit({
      embeds: [buildAPEmbed(guild.id, panel)],
      components: buildAPRows(guild.id, panel)
    });

    return true;
  } catch {
    return false;
  }
}

function buildAPPainelConfigEmbed(interaction) {
  const config = getAPConfig(interaction.guild.id);
  const values = generateAPValues(config.minValue, config.maxValue);

  return new EmbedBuilder()
    .setColor(parseColor(config.color || "#00ffff"))
    .setTitle("🎮 Painel de AP / Filas")
    .setDescription(
      "Configure abaixo como os painéis serão enviados.\n\n" +
        `📢 **Canal:** ${config.channelId ? `<#${config.channelId}>` : "`Não configurado`"}\n` +
        `👥 **Equipe:** \`${config.team}\`\n` +
        `${apDeviceEmoji(config.device)} **Dispositivo:** \`${normalizeAPDevice(config.device)}\`\n` +
        `💰 **Valores:** \`${formatAPMoney(config.minValue)} até ${formatAPMoney(config.maxValue)}\`\n` +
        `📦 **Quantidade de painéis:** \`${values.length}\`\n` +
        `📝 **Título:** \`${config.title || "Fila"}\`\n` +
        `🖼️ **Imagem:** ${config.image ? config.image : "`Sem imagem`"}\n\n` +
        "Depois de configurar, clique em **Enviar Painéis**."
    )
    .setFooter({ text: "Sistema de filas estilo TIGRE NEGRO" })
    .setTimestamp();
}

function buildAPPainelConfigRows() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ap_edit_message")
      .setLabel("Editar mensagem")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("ap_edit_team")
      .setLabel("Editar equipe")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("ap_edit_device")
      .setLabel("Dispositivo")
      .setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ap_edit_values")
      .setLabel("Valores")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("ap_edit_channel")
      .setLabel("Editar canal")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("ap_send_panels")
      .setLabel("Enviar Painéis")
      .setStyle(ButtonStyle.Danger)
  );

  return [row1, row2];
}

async function sendAPPainelConfig(interaction) {
  return interaction.reply({
    embeds: [buildAPPainelConfigEmbed(interaction)],
    components: buildAPPainelConfigRows(),
    ephemeral: true
  });
}

async function refreshAPPainelConfig(interaction, content = "✅ Configuração atualizada.") {
  return interaction.update({
    content,
    embeds: [buildAPPainelConfigEmbed(interaction)],
    components: buildAPPainelConfigRows()
  });
}

async function sendAPPanels(interaction) {
  const config = getAPConfig(interaction.guild.id);

  if (!config.channelId) {
    return interaction.reply({
      content: "❌ Configure o canal onde os painéis serão enviados.",
      ephemeral: true
    });
  }

  const channel = interaction.guild.channels.cache.get(config.channelId);

  if (!channel || channel.type !== ChannelType.GuildText) {
    return interaction.reply({
      content: "❌ Canal inválido. Configure um canal de texto válido.",
      ephemeral: true
    });
  }

  const values = generateAPValues(config.minValue, config.maxValue);

  if (values.length === 0) {
    return interaction.reply({
      content: "❌ Nenhum valor válido foi gerado. Confira mínimo e máximo.",
      ephemeral: true
    });
  }

  await interaction.reply({
    content: `⏳ Enviando ${values.length} painéis em ${channel}...`,
    ephemeral: true
  });

  const db = loadDB();

  for (const price of values) {
    const panel = {
      guildId: interaction.guild.id,
      channelId: channel.id,
      team: config.team,
      device: normalizeAPDevice(config.device),
      title: config.title || "Fila",
      message: config.message || "",
      image: config.image || "",
      color: config.color || "#00ffff",
      price,
      players: {},
      createdAt: Date.now()
    };

    const msg = await channel.send({
      embeds: [buildAPEmbed(interaction.guild.id, panel)],
      components: buildAPRows(interaction.guild.id, panel)
    });

    panel.messageId = msg.id;
    db.apPanels[msg.id] = panel;
    saveDB(db);
  }

  return interaction.followUp({
    content: `✅ ${values.length} painéis enviados com sucesso em ${channel}.`,
    ephemeral: true
  });
}

async function sendConfigPanel(interaction) {
  const config = getGuildConfig(interaction.guild.id);

  const guildIcon = interaction.guild.iconURL({
    dynamic: true,
    size: 1024
  });

  const configured = isConfigured(interaction.guild.id);

  const embed = new EmbedBuilder()
    .setColor(getConfigColor(interaction.guild.id))
    .setTitle(`🎀 | ${config.storeName || "Anjinha Store"} - Painel de Configuração`)
    .setDescription(
      "Transforme sua loja virtual em um verdadeiro sucesso. Veja abaixo tudo que você pode configurar e personalizar para deixar o sistema pronto para vendas.\n\n" +
        "────────────────────────\n\n" +
        "</> **Painel de navegação**\n\n" +
        `🛠️ **Configurar loja**\n` +
        `Altere o nome da loja e a cor principal do sistema.\n\n` +
        `📁 **Configurar canais**\n` +
        `Defina o cargo da equipe, canal de entregas e categoria dos carrinhos.\n\n` +
        `💳 **Configurar pagamentos**\n` +
        `Configure a chave Pix que será enviada ao cliente na hora da compra.\n\n` +
        `🗄️ **Configurar automação**\n` +
        `Crie mensagens personalizadas em embed para enviar em canais escolhidos.\n\n` +
        `✅ **Verificar configuração**\n` +
        `Veja se o bot já está pronto para funcionar corretamente.\n\n` +
        "────────────────────────\n\n" +
        `📌 **Status atual:** ${
          configured
            ? "✅ Sistema configurado e pronto para vendas."
            : "⚠️ Ainda falta configurar algumas informações."
        }`
    )
    .addFields(
      {
        name: "🏪 Nome da loja",
        value: config.storeName ? `\`${config.storeName}\`` : "`Anjinha Store`",
        inline: true
      },
      {
        name: "🎨 Cor principal",
        value: config.mainColor ? `\`${config.mainColor}\`` : "`#9b59b6`",
        inline: true
      },
      {
        name: "👑 Cargo admin",
        value: config.adminRoleId ? `<@&${config.adminRoleId}>` : "`Não configurado`",
        inline: true
      },
      {
        name: "📦 Canal de entregas",
        value: config.deliveryChannelId
          ? `<#${config.deliveryChannelId}>`
          : "`Não configurado`",
        inline: true
      },
      {
        name: "🛒 Categoria carrinhos",
        value: config.cartCategoryId ? `<#${config.cartCategoryId}>` : "`Automática`",
        inline: true
      },
      {
        name: "💸 Chave Pix",
        value: config.pixKey ? "`Configurada`" : "`Não configurada`",
        inline: true
      }
    )
    .setFooter({
      text: `${interaction.guild.name} • Sistema de loja automatizada`,
      iconURL: guildIcon || undefined
    })
    .setTimestamp();

  if (guildIcon) {
    embed.setThumbnail(guildIcon);
  }

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("config_loja")
      .setLabel("Configurar Loja")
      .setEmoji("🛠️")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("config_pagamento")
      .setLabel("Configurar Pagamentos")
      .setEmoji("💳")
      .setStyle(ButtonStyle.Primary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("config_canais")
      .setLabel("Configurar Canais")
      .setEmoji("📁")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("config_verificar")
      .setLabel("Verificar Configuração")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("config_seguranca_off")
      .setLabel("Gerenciar Segurança")
      .setEmoji("🛡️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),

    new ButtonBuilder()
  .setCustomId("config_personalizacao")
  .setLabel("Personalização")
  .setEmoji("🖌️")
  .setStyle(ButtonStyle.Secondary)
    );

  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("config_automacao")
      .setLabel("Configurar Automação")
      .setEmoji("🗄️")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("config_equipe_off")
      .setLabel("Gerenciar Equipe")
      .setEmoji("👥")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true)
  );

  return interaction.reply({
    embeds: [embed],
    components: [row1, row2, row3, row4],
    ephemeral: true
  });
}

async function sendAutomationPanel(interaction) {
  const guildIcon = interaction.guild.iconURL({
    dynamic: true,
    size: 1024
  });

  const embed = new EmbedBuilder()
    .setColor(getConfigColor(interaction.guild.id))
    .setTitle("🗄️ | Painel de Automação")
    .setDescription(
      "Configure automações para facilitar o funcionamento da sua loja.\n\n" +
        "📨 **Criar mensagem personalizada**\n" +
        "Crie uma embed personalizada e envie em um canal escolhido.\n\n" +
        "Selecione abaixo o canal onde a mensagem será enviada."
    )
    .setFooter({
      text: `${interaction.guild.name} • Sistema de automação`,
      iconURL: guildIcon || undefined
    })
    .setTimestamp();

  if (guildIcon) {
    embed.setThumbnail(guildIcon);
  }

  const channelRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("automation_select_channel")
      .setPlaceholder("Selecione o canal para enviar a mensagem")
      .setChannelTypes(ChannelType.GuildText)
      .setMinValues(1)
      .setMaxValues(1)
  );

  return interaction.reply({
    embeds: [embed],
    components: [channelRow],
    ephemeral: true
  });
}

async function sendPersonalizationPanel(interaction) {
  const config = getGuildConfig(interaction.guild.id);

  const guildIcon = interaction.guild.iconURL({
    dynamic: true,
    size: 1024
  });

  const embed = new EmbedBuilder()
    .setColor(getConfigColor(interaction.guild.id))
    .setTitle("🖌️ | Painel de Personalização")
    .setDescription(
      "Configure os canais personalizados do servidor.\n\n" +
        "📨 **Canal de invites**\n" +
        "Canal onde o bot vai enviar logs de convites usados quando alguém entrar.\n\n" +
        "👋 **Canal de entradas**\n" +
        "Canal onde o bot vai anunciar novos membros entrando no servidor.\n\n" +
        "────────────────────────\n\n" +
        `📨 **Canal de invites atual:** ${
          config.inviteChannelId ? `<#${config.inviteChannelId}>` : "`Não configurado`"
        }\n` +
        `👋 **Canal de entradas atual:** ${
          config.welcomeChannelId ? `<#${config.welcomeChannelId}>` : "`Não configurado`"
        }`
    )
    .setFooter({
      text: `${interaction.guild.name} • Personalização`,
      iconURL: guildIcon || undefined
    })
    .setTimestamp();

  if (guildIcon) {
    embed.setThumbnail(guildIcon);
  }

  const row1 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("personalization_invite_channel")
      .setPlaceholder("Selecionar canal de invites")
      .setChannelTypes(ChannelType.GuildText)
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("personalization_welcome_channel")
      .setPlaceholder("Selecionar canal de entradas")
      .setChannelTypes(ChannelType.GuildText)
      .setMinValues(1)
      .setMaxValues(1)
  );

  return interaction.reply({
    embeds: [embed],
    components: [row1, row2],
    ephemeral: true
  });
}

async function cacheGuildInvites(guild) {
  try {
    const invites = await guild.invites.fetch();

    client.invites.set(
      guild.id,
      new Map(invites.map((invite) => [invite.code, invite.uses || 0]))
    );
  } catch {
    client.invites.set(guild.id, new Map());
  }
}

async function getOrCreateCart(interaction, db) {
  const guild = interaction.guild;
  const user = interaction.user;
  const config = getGuildConfig(guild.id);
  const adminRoleId = config.adminRoleId || process.env.ADMIN_ROLE_ID;

  let cart = Object.values(db.carts).find(
    (c) =>
      c.userId === user.id &&
      c.status === "open" &&
      c.guildId === guild.id
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

client.once("ready", async () => {
  console.log(`✅ Bot online como ${client.user.tag}`);

    client.invites = new Map();

  for (const guild of client.guilds.cache.values()) {
    await cacheGuildInvites(guild);
  }

  const commands = [
    new SlashCommandBuilder()
      .setName("configurar")
      .setDescription("Abre o painel de configuração geral do bot.")
      .toJSON(),

    new SlashCommandBuilder()
      .setName("painel")
      .setDescription("Configura e envia painéis de AP / filas.")
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
      .setName("editarproduto")
      .setDescription("Edita um produto já criado pelo ID.")
      .addStringOption((option) =>
        option
          .setName("id")
          .setDescription("ID do produto que será editado.")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("titulo")
          .setDescription("Novo título da embed.")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("produto")
          .setDescription("Novo nome do produto.")
          .setRequired(false)
      )
      .addNumberOption((option) =>
        option
          .setName("preco")
          .setDescription("Novo preço do produto.")
          .setRequired(false)
      )
      .addIntegerOption((option) =>
        option
          .setName("estoque")
          .setDescription("Novo estoque do produto.")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("descricao")
          .setDescription("Nova descrição do produto.")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("imagem")
          .setDescription("Novo link da imagem ou digite remover.")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("emoji")
          .setDescription("Novo emoji do produto.")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("cor")
          .setDescription("Nova cor em hexadecimal. Exemplo: #F1C40F")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("rodape")
          .setDescription("Novo texto do rodapé.")
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
      .toJSON(),

    new SlashCommandBuilder()
      .setName("editarcupom")
      .setDescription("Edita um cupom já criado pelo código.")
      .addStringOption((option) =>
        option
          .setName("codigo")
          .setDescription("Código do cupom que será editado.")
          .setRequired(true)
      )
      .addNumberOption((option) =>
        option
          .setName("desconto")
          .setDescription("Nova porcentagem de desconto.")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("titulo")
          .setDescription("Novo título da mensagem do cupom.")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("descricao")
          .setDescription("Nova descrição personalizada.")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("cor")
          .setDescription("Nova cor em hexadecimal. Exemplo: #F1C40F")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("status")
          .setDescription("Ativar ou desativar o cupom.")
          .setRequired(false)
          .addChoices(
            { name: "Ativar", value: "ativar" },
            { name: "Desativar", value: "desativar" }
          )
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
      if (interaction.commandName === "configurar") {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({
            content: "❌ Apenas administradores podem abrir a configuração.",
            ephemeral: true
          });
        }

        return sendConfigPanel(interaction);
      }

      if (interaction.commandName === "painel") {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({
            content: "❌ Apenas administradores podem abrir o painel de AP.",
            ephemeral: true
          });
        }

        return sendAPPainelConfig(interaction);
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


      if (interaction.customId === "ap_edit_message") {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({ content: "❌ Apenas administradores.", ephemeral: true });
        }

        const config = getAPConfig(interaction.guild.id);
        const modal = new ModalBuilder()
          .setCustomId("modal_ap_message")
          .setTitle("Editar mensagem do painel");

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("title")
              .setLabel("Título da fila")
              .setValue(config.title || "Fila")
              .setRequired(true)
              .setStyle(TextInputStyle.Short)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("message")
              .setLabel("Mensagem/observação")
              .setValue(config.message || "Clique em um botão para entrar na fila.")
              .setRequired(false)
              .setStyle(TextInputStyle.Paragraph)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("image")
              .setLabel("URL da imagem/thumbnail")
              .setValue(config.image || "")
              .setRequired(false)
              .setStyle(TextInputStyle.Short)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("color")
              .setLabel("Cor HEX")
              .setValue(config.color || "#00ffff")
              .setRequired(false)
              .setStyle(TextInputStyle.Short)
          )
        );

        return interaction.showModal(modal);
      }

      if (interaction.customId === "ap_edit_values") {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({ content: "❌ Apenas administradores.", ephemeral: true });
        }

        const config = getAPConfig(interaction.guild.id);
        const modal = new ModalBuilder()
          .setCustomId("modal_ap_values")
          .setTitle("Editar valores dos painéis");

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("min")
              .setLabel("Valor mínimo")
              .setPlaceholder("Exemplo: 0,30")
              .setValue(String(config.minValue).replace(".", ","))
              .setRequired(true)
              .setStyle(TextInputStyle.Short)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("max")
              .setLabel("Valor máximo")
              .setPlaceholder("Exemplo: 100")
              .setValue(String(config.maxValue).replace(".", ","))
              .setRequired(true)
              .setStyle(TextInputStyle.Short)
          )
        );

        return interaction.showModal(modal);
      }

      if (interaction.customId === "ap_edit_channel") {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({ content: "❌ Apenas administradores.", ephemeral: true });
        }

        const modal = new ModalBuilder()
          .setCustomId("modal_ap_channel")
          .setTitle("Canal dos painéis de AP");

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("channel")
              .setLabel("ID do canal")
              .setPlaceholder("Cole aqui o ID do canal")
              .setRequired(true)
              .setStyle(TextInputStyle.Short)
          )
        );

        return interaction.showModal(modal);
      }

      if (interaction.customId === "ap_edit_team") {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({ content: "❌ Apenas administradores.", ephemeral: true });
        }

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("ap_select_team")
            .setPlaceholder("Escolha a equipe")
            .addOptions(
              { label: "1v1", value: "1v1", emoji: "1️⃣" },
              { label: "2v2", value: "2v2", emoji: "2️⃣" },
              { label: "3v3", value: "3v3", emoji: "3️⃣" },
              { label: "4v4", value: "4v4", emoji: "4️⃣" }
            )
        );

        return interaction.reply({
          content: "👥 Selecione a equipe do painel:",
          components: [row],
          ephemeral: true
        });
      }

      if (interaction.customId === "ap_edit_device") {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({ content: "❌ Apenas administradores.", ephemeral: true });
        }

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("ap_select_device")
            .setPlaceholder("Escolha o dispositivo")
            .addOptions(
              { label: "Pc", value: "Pc", emoji: "💻" },
              { label: "Mobile", value: "Mobile", emoji: "📱" },
              { label: "Misto", value: "Misto", emoji: "🔄" }
            )
        );

        return interaction.reply({
          content: "📱 Selecione o dispositivo do painel:",
          components: [row],
          ephemeral: true
        });
      }

      if (interaction.customId === "ap_send_panels") {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({ content: "❌ Apenas administradores.", ephemeral: true });
        }

        return sendAPPanels(interaction);
      }

      if (["ap_join_normal", "ap_join_full", "ap_join_mobilador", "ap_leave"].includes(interaction.customId)) {
        const freshDb = loadDB();
        const panel = freshDb.apPanels[interaction.message.id];

        if (!panel) {
          return interaction.reply({
            content: "❌ Este painel não está registrado no banco de dados.",
            ephemeral: true
          });
        }

        if (interaction.customId === "ap_leave") {
          delete panel.players[interaction.user.id];
        } else {
          const labels = {
            ap_join_normal: getAPConfig(interaction.guild.id).normalLabel || "Normal",
            ap_join_full: getAPConfig(interaction.guild.id).fullLabel || "Full Ump Xm8",
            ap_join_mobilador: getAPConfig(interaction.guild.id).mobiladorLabel || "Mobilador"
          };

          panel.players[interaction.user.id] = {
            choice: labels[interaction.customId],
            username: interaction.user.username,
            updatedAt: Date.now()
          };
        }

        freshDb.apPanels[interaction.message.id] = panel;
        saveDB(freshDb);

        await interaction.update({
          embeds: [buildAPEmbed(interaction.guild.id, panel)],
          components: buildAPRows(interaction.guild.id, panel)
        });
        return;
      }

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
          channelId: null,
          messageId: null,
          createdAt: Date.now(),
          updatedAt: null
        };

        db.products[product.id] = product;
        saveDB(db);

        await sendProductMessage(interaction, product);

        return interaction.reply({
          content:
            `✅ Produto criado e enviado com sucesso.\n` +
            `🆔 **ID do produto:** \`${product.id}\`\n\n` +
            `Use esse ID no comando \`/editarproduto\`.`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "editarproduto") {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({
            content: "❌ Apenas administradores podem editar produtos.",
            ephemeral: true
          });
        }

        const productId = interaction.options
          .getString("id")
          .trim()
          .toUpperCase();

        const db = loadDB();
        const product = db.products[productId];

        if (!product) {
          return interaction.reply({
            content: "❌ Produto não encontrado. Confira o ID informado.",
            ephemeral: true
          });
        }

        if (product.guildId && product.guildId !== interaction.guild.id) {
          return interaction.reply({
            content: "❌ Este produto não pertence a este servidor.",
            ephemeral: true
          });
        }

        const newTitle = interaction.options.getString("titulo");
        const newName = interaction.options.getString("produto");
        const newPrice = interaction.options.getNumber("preco");
        const newStock = interaction.options.getInteger("estoque");
        const newDescription = interaction.options.getString("descricao");
        const newImage = interaction.options.getString("imagem");
        const newEmoji = interaction.options.getString("emoji");
        const newColor = interaction.options.getString("cor");
        const newFooter = interaction.options.getString("rodape");

        if (
          newTitle === null &&
          newName === null &&
          newPrice === null &&
          newStock === null &&
          newDescription === null &&
          newImage === null &&
          newEmoji === null &&
          newColor === null &&
          newFooter === null
        ) {
          return interaction.reply({
            content:
              "❌ Você precisa informar pelo menos uma informação para editar.",
            ephemeral: true
          });
        }

        if (newPrice !== null && newPrice <= 0) {
          return interaction.reply({
            content: "❌ O preço precisa ser maior que 0.",
            ephemeral: true
          });
        }

        if (newStock !== null && newStock < 0) {
          return interaction.reply({
            content: "❌ O estoque não pode ser negativo.",
            ephemeral: true
          });
        }

        if (newColor !== null && !/^#?[0-9A-Fa-f]{6}$/.test(newColor)) {
          return interaction.reply({
            content: "❌ Cor inválida. Use o formato HEX. Exemplo: #F1C40F",
            ephemeral: true
          });
        }

        if (newTitle !== null) product.title = newTitle;
        if (newName !== null) product.name = newName;
        if (newPrice !== null) product.price = newPrice;
        if (newStock !== null) product.stock = newStock;
        if (newDescription !== null) product.description = newDescription;

        if (newImage !== null) {
          const imageValue = newImage.trim();

          if (imageValue.toLowerCase() === "remover") {
            product.image = null;
          } else {
            product.image = imageValue;
          }
        }

        if (newEmoji !== null) product.emoji = newEmoji;
        if (newColor !== null) product.color = parseColor(newColor);
        if (newFooter !== null) product.footer = newFooter;

        product.updatedAt = Date.now();

        db.products[product.id] = product;
        saveDB(db);

        const editedMessage = await updateProductMessage(
          interaction.guild,
          product
        );

        return interaction.reply({
          content:
            `✅ Produto \`${product.id}\` editado com sucesso.\n` +
            (editedMessage
              ? "✅ A mensagem do produto também foi atualizada."
              : "⚠️ Produto salvo, mas não consegui editar a mensagem antiga. Talvez ela tenha sido apagada ou o bot não tenha permissão."),
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
        const couponKey = `${interaction.guild.id}_${code}`;

        const coupon = {
          code,
          guildId: interaction.guild.id,
          discount,
          title,
          description,
          color,
          createdBy: interaction.user.id,
          createdAt: Date.now(),
          updatedAt: null,
          active: true,
          channelId: null,
          messageId: null
        };

        db.coupons[couponKey] = coupon;
        saveDB(db);

        const msg = await interaction.channel.send({
          embeds: [buildCouponEmbed(interaction.guild.id, coupon)]
        });

        const newDb = loadDB();

        if (newDb.coupons[couponKey]) {
          newDb.coupons[couponKey].channelId = msg.channel.id;
          newDb.coupons[couponKey].messageId = msg.id;
          saveDB(newDb);
        }

        return interaction.reply({
          content: `✅ Cupom \`${code}\` criado com ${discount}% de desconto.`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "editarcupom") {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({
            content: "❌ Apenas administradores podem editar cupons.",
            ephemeral: true
          });
        }

        const code = interaction.options
          .getString("codigo")
          .trim()
          .toUpperCase()
          .replace(/\s+/g, "");

        const db = loadDB();
        const couponKey = `${interaction.guild.id}_${code}`;
        const coupon = db.coupons[couponKey] || db.coupons[code];

        if (!coupon) {
          return interaction.reply({
            content: "❌ Cupom não encontrado. Confira o código informado.",
            ephemeral: true
          });
        }

        if (coupon.guildId && coupon.guildId !== interaction.guild.id) {
          return interaction.reply({
            content: "❌ Este cupom não pertence a este servidor.",
            ephemeral: true
          });
        }

        const newDiscount = interaction.options.getNumber("desconto");
        const newTitle = interaction.options.getString("titulo");
        const newDescription = interaction.options.getString("descricao");
        const newColor = interaction.options.getString("cor");
        const newStatus = interaction.options.getString("status");

        if (
          newDiscount === null &&
          newTitle === null &&
          newDescription === null &&
          newColor === null &&
          newStatus === null
        ) {
          return interaction.reply({
            content:
              "❌ Você precisa informar pelo menos uma informação para editar.",
            ephemeral: true
          });
        }

        if (newDiscount !== null && (newDiscount <= 0 || newDiscount > 90)) {
          return interaction.reply({
            content: "❌ O desconto precisa ser maior que 0 e no máximo 90%.",
            ephemeral: true
          });
        }

        if (newColor !== null && !/^#?[0-9A-Fa-f]{6}$/.test(newColor)) {
          return interaction.reply({
            content: "❌ Cor inválida. Use o formato HEX. Exemplo: #F1C40F",
            ephemeral: true
          });
        }

        if (newDiscount !== null) coupon.discount = newDiscount;
        if (newTitle !== null) coupon.title = newTitle;
        if (newDescription !== null) coupon.description = newDescription;
        if (newColor !== null) coupon.color = parseColor(newColor);

        if (newStatus !== null) {
          coupon.active = newStatus === "ativar";
        }

        coupon.updatedAt = Date.now();

        db.coupons[`${interaction.guild.id}_${coupon.code}`] = coupon;
        saveDB(db);

        const editedMessage = await updateCouponMessage(interaction.guild, coupon);

        return interaction.reply({
          content:
            `✅ Cupom \`${coupon.code}\` editado com sucesso.\n` +
            (editedMessage
              ? "✅ A mensagem do cupom também foi atualizada."
              : "⚠️ Cupom salvo, mas não consegui editar a mensagem antiga. Talvez ela tenha sido apagada ou o bot não tenha permissão."),
          ephemeral: true
        });
      }
    }

    
    if (interaction.isStringSelectMenu()) {
      if (!isAdmin(interaction.member)) {
        return interaction.reply({
          content: "❌ Apenas administradores podem alterar essa configuração.",
          ephemeral: true
        });
      }

      if (interaction.customId === "ap_select_team") {
        updateAPConfig(interaction.guild.id, { team: interaction.values[0] });
        return refreshAPPainelConfig(interaction, "✅ Equipe alterada com sucesso.");
      }

      if (interaction.customId === "ap_select_device") {
        updateAPConfig(interaction.guild.id, { device: interaction.values[0] });
        return refreshAPPainelConfig(interaction, "✅ Dispositivo alterado com sucesso.");
      }
    }

    if (interaction.isChannelSelectMenu()) {
      if (interaction.customId === "automation_select_channel") {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({
            content: "❌ Apenas administradores podem usar a automação.",
            ephemeral: true
          });
        }

        await interaction.deferUpdate();

        const channelId = interaction.values[0];
        const channel = interaction.guild.channels.cache.get(channelId);

        if (!channel || channel.type !== ChannelType.GuildText) {
          return interaction.followUp({
            content: "❌ Canal inválido. Selecione um canal de texto.",
            ephemeral: true
          });
        }

        const embed = new EmbedBuilder()
          .setColor(getConfigColor(interaction.guild.id))
          .setTitle("📨 | Criar mensagem personalizada")
          .setDescription(
            `Canal selecionado: <#${channelId}>\n\n` +
              "Clique no botão abaixo para configurar a embed personalizada que será enviada nesse canal."
          )
          .setFooter({
            text: `${interaction.guild.name} • Mensagem personalizada`
          })
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`custom_message_create_${channelId}`)
            .setLabel("Criar mensagem personalizada")
            .setEmoji("📨")
            .setStyle(ButtonStyle.Primary)
        );

        return interaction.editReply({
          embeds: [embed],
          components: [row]
        });
      }

      if (interaction.customId === "personalization_invite_channel") {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({
            content: "❌ Apenas administradores podem configurar o canal de invites.",
            ephemeral: true
          });
        }

        await interaction.deferUpdate();

        const channelId = interaction.values[0];
        const channel = interaction.guild.channels.cache.get(channelId);

        if (!channel || channel.type !== ChannelType.GuildText) {
          return interaction.followUp({
            content: "❌ Canal inválido. Selecione um canal de texto.",
            ephemeral: true
          });
        }

        updateGuildConfig(interaction.guild.id, {
          inviteChannelId: channelId
        });

        if (typeof cacheGuildInvites === "function") {
          await cacheGuildInvites(interaction.guild);
        }

        return interaction.followUp({
          content: `✅ Canal de invites configurado para <#${channelId}>.`,
          ephemeral: true
        });
      }

      if (interaction.customId === "personalization_welcome_channel") {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({
            content: "❌ Apenas administradores podem configurar o canal de entradas.",
            ephemeral: true
          });
        }

        await interaction.deferUpdate();

        const channelId = interaction.values[0];
        const channel = interaction.guild.channels.cache.get(channelId);

        if (!channel || channel.type !== ChannelType.GuildText) {
          return interaction.followUp({
            content: "❌ Canal inválido. Selecione um canal de texto.",
            ephemeral: true
          });
        }

        updateGuildConfig(interaction.guild.id, {
          welcomeChannelId: channelId
        });

        return interaction.followUp({
          content: `✅ Canal de entradas configurado para <#${channelId}>.`,
          ephemeral: true
        });
      }
    }

      if (interaction.isButton()) {
      const db = loadDB();

              if (interaction.customId === "config_personalizacao") {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({
            content: "❌ Apenas administradores podem configurar a personalização.",
            ephemeral: true
          });
        }

        return sendPersonalizationPanel(interaction);
      }

      if (interaction.customId === "config_automacao") {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({
            content: "❌ Apenas administradores podem configurar automações.",
            ephemeral: true
          });
        }

        return sendAutomationPanel(interaction);
      }

      if (interaction.customId.startsWith("custom_message_create_")) {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({
            content: "❌ Apenas administradores podem criar mensagens personalizadas.",
            ephemeral: true
          });
        }

        const channelId = interaction.customId.replace("custom_message_create_", "");
        const channel = interaction.guild.channels.cache.get(channelId);

        if (!channel || channel.type !== ChannelType.GuildText) {
          return interaction.reply({
            content: "❌ Canal inválido ou não encontrado.",
            ephemeral: true
          });
        }

        const modal = new ModalBuilder()
          .setCustomId(`modal_custom_message_${channelId}`)
          .setTitle("Mensagem personalizada");

        const titleInput = new TextInputBuilder()
          .setCustomId("custom_title")
          .setLabel("Título da embed")
          .setPlaceholder("Exemplo: Bem-vindo à Anjinha Store")
          .setRequired(true)
          .setStyle(TextInputStyle.Short);

        const descriptionInput = new TextInputBuilder()
          .setCustomId("custom_description")
          .setLabel("Descrição da embed")
          .setPlaceholder("Digite o texto principal da mensagem")
          .setRequired(true)
          .setStyle(TextInputStyle.Paragraph);

        const colorInput = new TextInputBuilder()
          .setCustomId("custom_color")
          .setLabel("Cor em HEX")
          .setPlaceholder("Exemplo: #9B59B6")
          .setRequired(false)
          .setStyle(TextInputStyle.Short);

        const imageInput = new TextInputBuilder()
          .setCustomId("custom_image")
          .setLabel("Link da imagem/banner")
          .setPlaceholder("Opcional")
          .setRequired(false)
          .setStyle(TextInputStyle.Short);

        const footerInput = new TextInputBuilder()
          .setCustomId("custom_footer")
          .setLabel("Rodapé da embed")
          .setPlaceholder("Exemplo: Anjinha Store • Sistema automático")
          .setRequired(false)
          .setStyle(TextInputStyle.Short);

        modal.addComponents(
          new ActionRowBuilder().addComponents(titleInput),
          new ActionRowBuilder().addComponents(descriptionInput),
          new ActionRowBuilder().addComponents(colorInput),
          new ActionRowBuilder().addComponents(imageInput),
          new ActionRowBuilder().addComponents(footerInput)
        );

        return interaction.showModal(modal);
      }

      if (interaction.customId === "config_loja") {
        if (
          !interaction.member.permissions.has(
            PermissionsBitField.Flags.Administrator
          )
        ) {
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
        if (
          !interaction.member.permissions.has(
            PermissionsBitField.Flags.Administrator
          )
        ) {
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
        if (
          !interaction.member.permissions.has(
            PermissionsBitField.Flags.Administrator
          )
        ) {
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
            content:
              "❌ Este servidor ainda não foi configurado. Use `/painel` primeiro.",
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
          existing.name = product.name;
          existing.price = product.price;
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

        return;
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

            await updateProductMessage(interaction.guild, db.products[item.id]);
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

        const deliveryChannel =
          interaction.guild.channels.cache.get(deliveryChannelId);

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

        return;
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

      if (interaction.customId === "modal_ap_message") {
        const title = interaction.fields.getTextInputValue("title").trim();
        const message = interaction.fields.getTextInputValue("message").trim();
        const image = interaction.fields.getTextInputValue("image").trim();
        const color = interaction.fields.getTextInputValue("color").trim() || "#00ffff";

        if (color && !/^#?[0-9A-Fa-f]{6}$/.test(color)) {
          return interaction.reply({
            content: "❌ Cor inválida. Use HEX. Exemplo: #00ffff",
            ephemeral: true
          });
        }

        updateAPConfig(interaction.guild.id, {
          title,
          message,
          image,
          color: color.startsWith("#") ? color : `#${color}`
        });

        return interaction.reply({
          content: "✅ Mensagem do painel de AP atualizada.",
          ephemeral: true
        });
      }

      if (interaction.customId === "modal_ap_values") {
        const min = Number(interaction.fields.getTextInputValue("min").replace(",", "."));
        const max = Number(interaction.fields.getTextInputValue("max").replace(",", "."));

        if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) {
          return interaction.reply({
            content: "❌ Valores inválidos. O mínimo precisa ser maior que 0 e o máximo precisa ser maior ou igual ao mínimo.",
            ephemeral: true
          });
        }

        updateAPConfig(interaction.guild.id, {
          minValue: Math.round(min * 100) / 100,
          maxValue: Math.round(max * 100) / 100
        });

        return interaction.reply({
          content: `✅ Valores atualizados: ${formatAPMoney(min)} até ${formatAPMoney(max)}.`,
          ephemeral: true
        });
      }

      if (interaction.customId === "modal_ap_channel") {
        const channelId = interaction.fields.getTextInputValue("channel").trim();
        const channel = interaction.guild.channels.cache.get(channelId);

        if (!channel || channel.type !== ChannelType.GuildText) {
          return interaction.reply({
            content: "❌ Canal inválido. Cole o ID de um canal de texto.",
            ephemeral: true
          });
        }

        updateAPConfig(interaction.guild.id, { channelId });

        return interaction.reply({
          content: `✅ Canal dos painéis configurado para ${channel}.`,
          ephemeral: true
        });
      }

      if (interaction.customId === "modal_config_loja") {
        const storeName = interaction.fields
          .getTextInputValue("store_name")
          .trim();

        const mainColor = interaction.fields
          .getTextInputValue("main_color")
          .trim();

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
        const deliveryChannel =
          interaction.guild.channels.cache.get(deliveryChannelId);

        if (!role) {
          return interaction.reply({
            content: "❌ Cargo admin não encontrado. Confira o ID.",
            ephemeral: true
          });
        }

        if (!deliveryChannel || deliveryChannel.type !== ChannelType.GuildText) {
          return interaction.reply({
            content:
              "❌ Canal de entregas inválido. Use o ID de um canal de texto.",
            ephemeral: true
          });
        }

        if (cartCategoryId) {
          const category = interaction.guild.channels.cache.get(cartCategoryId);

          if (!category || category.type !== ChannelType.GuildCategory) {
            return interaction.reply({
              content:
                "❌ Categoria inválida. Use o ID de uma categoria ou deixe vazio.",
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

      if (interaction.customId.startsWith("modal_custom_message_")) {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({
            content: "❌ Apenas administradores podem enviar mensagens personalizadas.",
            ephemeral: true
          });
        }

        const channelId = interaction.customId.replace("modal_custom_message_", "");
        const channel = interaction.guild.channels.cache.get(channelId);

        if (!channel || channel.type !== ChannelType.GuildText) {
          return interaction.reply({
            content: "❌ Canal inválido ou não encontrado.",
            ephemeral: true
          });
        }

        const title = interaction.fields
          .getTextInputValue("custom_title")
          .trim();

        const description = interaction.fields
          .getTextInputValue("custom_description")
          .trim();

        const colorText = interaction.fields
          .getTextInputValue("custom_color")
          .trim();

        const image = interaction.fields
          .getTextInputValue("custom_image")
          .trim();

        const footer = interaction.fields
          .getTextInputValue("custom_footer")
          .trim();

        if (colorText && !/^#?[0-9A-Fa-f]{6}$/.test(colorText)) {
          return interaction.reply({
            content: "❌ Cor inválida. Use o formato HEX. Exemplo: #9B59B6",
            ephemeral: true
          });
        }

        const embed = new EmbedBuilder()
          .setColor(
            colorText
              ? parseColor(colorText)
              : getConfigColor(interaction.guild.id)
          )
          .setTitle(title)
          .setDescription(description)
          .setTimestamp();

        if (image) {
          embed.setImage(image);
        }

        embed.setFooter({
          text:
            footer ||
            `${getGuildConfig(interaction.guild.id).storeName} • Mensagem automática`
        });

        await channel.send({
          embeds: [embed]
        });

        return interaction.reply({
          content: `✅ Mensagem personalizada enviada com sucesso em <#${channelId}>.`,
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

client.on("guildMemberAdd", async (member) => {
  try {
    const config = getGuildConfig(member.guild.id);

    let usedInvite = null;

    try {
      const oldInvites = client.invites.get(member.guild.id) || new Map();
      const newInvites = await member.guild.invites.fetch();

      usedInvite = newInvites.find((invite) => {
        const oldUses = oldInvites.get(invite.code) || 0;
        return (invite.uses || 0) > oldUses;
      });

      client.invites.set(
        member.guild.id,
        new Map(newInvites.map((invite) => [invite.code, invite.uses || 0]))
      );
    } catch {
      usedInvite = null;
    }

    if (config.welcomeChannelId) {
      const welcomeChannel = member.guild.channels.cache.get(config.welcomeChannelId);

      if (welcomeChannel) {
        const welcomeEmbed = new EmbedBuilder()
  .setColor(getConfigColor(member.guild.id))
  .setTitle("🎀 | Nova entrada na Angel Store")
  .setDescription(
    `Seja muito bem-vindo(a), ${member}!\n\n` +
      "Estamos felizes em ter você aqui na nossa comunidade.\n" +
      "Confira os canais importantes, leia as regras e aproveite nossos produtos.\n\n" +
      `👥 Agora somos **${member.guild.memberCount} membros**.`
  )
  .setThumbnail(
    member.user.displayAvatarURL({
      dynamic: true,
      size: 1024
    })
  )
  .setFooter({
    text: `${member.guild.name} • Bem-vindo(a)!`
  })
  .setTimestamp();

        await welcomeChannel.send({
          content: `${member}`,
          embeds: [welcomeEmbed]
        });
      }
    }

    if (config.inviteChannelId) {
      const inviteChannel = member.guild.channels.cache.get(config.inviteChannelId);

      if (inviteChannel) {
        const inviteEmbed = new EmbedBuilder()
  .setColor(getConfigColor(member.guild.id))
  .setTitle("📨 | Novo membro via convite")
  .setDescription(
    `👤 **Membro:** ${member} \`${member.user.tag}\`\n` +
      `🆔 **ID:** \`${member.id}\`\n\n` +
      (usedInvite
        ? `🔗 **Convite usado:** \`${usedInvite.code}\`\n` +
          `👑 **Convidado por:** ${
            usedInvite.inviter ? `<@${usedInvite.inviter.id}>` : "`Desconhecido`"
          }\n` +
          `📊 **Usos totais do convite:** \`${usedInvite.uses || 0}\``
        : "⚠️ Não consegui identificar qual convite foi usado.")
  )
  
          .setThumbnail(
            member.user.displayAvatarURL({
              dynamic: true,
              size: 1024
            })
          )
          .setFooter({
            text: `${member.guild.name} • Sistema de invites`
          })
          .setTimestamp();

        await inviteChannel.send({
          embeds: [inviteEmbed]
        });
      }
    }
  } catch (error) {
    console.error("Erro no guildMemberAdd:", error);
  }
});

client.on("inviteCreate", async (invite) => {
  try {
    await cacheGuildInvites(invite.guild);
  } catch {}
});

client.on("inviteDelete", async (invite) => {
  try {
    await cacheGuildInvites(invite.guild);
  } catch {}
});

client.login(process.env.TOKEN);
