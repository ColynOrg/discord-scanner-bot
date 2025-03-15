import {
  Client,
  TextChannel,
  ThreadChannel,
  ForumChannel,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  EmbedBuilder,
  Colors,
  ComponentType,
  Message,
  ButtonInteraction,
  ChatInputCommandInteraction,
  time,
  Events,
  GuildMemberRoleManager
} from 'discord.js';

export class ForumManager {
  private static readonly FORUM_CHANNEL_ID = '1349920447957045329';
  private static readonly SOLVED_TAG_ID = '1349920578987102250';
  private static readonly AUTO_CLOSE_DELAY = 60 * 60 * 1000; // 1 hour in milliseconds
  private static readonly INACTIVITY_CHECK_DELAY = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  private static readonly activeThreads = new Map<string, NodeJS.Timeout>();
  private static readonly inactivityWarnings = new Map<string, boolean>(); // Track which threads have warnings

  constructor(private client: Client) {
    this.checkInactiveThreads();
    this.setupForumListeners();
  }

  private setupForumListeners() {
    // Listen for new threads
    this.client.on(Events.ThreadCreate, async (thread) => {
      if (thread.parentId === ForumManager.FORUM_CHANNEL_ID) {
        // Wait a short moment for the initial message to be available
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const messages = await thread.messages.fetch({ limit: 1 });
        const firstMessage = messages.first();
        
        // Check if the first message has no content or only attachments
        if (firstMessage && (!firstMessage.content || firstMessage.content.trim() === '')) {
          const embed = new EmbedBuilder()
            .setColor(Colors.Blue)
            .setTitle('Hello, please answer these questions if you haven\'t already, so we can help you faster.')
            .setDescription('• What exactly is your question or the problem you\'re experiencing?\n• What have you already tried?\n• What are you trying to do / what is your overall goal?\n• If possible, please include a screenshot or screen recording of your setup.');

          await thread.send({ embeds: [embed] });
        }
      }
    });

    // Listen for messages
    this.client.on(Events.MessageCreate, async (message) => {
      // Check if message is in a thread in our forum channel
      if (!message.channel.isThread()) return;
      const thread = message.channel as ThreadChannel;
      if (thread.parentId !== ForumManager.FORUM_CHANNEL_ID) return;

      // Check if message is from thread owner
      if (message.author.id !== thread.ownerId) return;

      // Reset inactivity warning when thread owner sends a message
      ForumManager.inactivityWarnings.delete(thread.id);

      // Check if message indicates the issue is solved
      const content = message.content.toLowerCase();
      if (content.includes('thanks') || content.includes('thank you') || content.includes('it works')) {
        // Don't suggest if the thread is already marked as solved
        if (!thread.appliedTags.includes(ForumManager.SOLVED_TAG_ID)) {
          await message.reply('-# <:tree_corner:1349121251733667921> command suggestion: Use </solved:1350200875062136844> to mark this post as resolved.');
        }
      }
    });
  }

  private async checkInactiveThreads() {
    setInterval(async () => {
      const forumChannel = await this.client.channels.fetch(ForumManager.FORUM_CHANNEL_ID) as ForumChannel;
      if (!forumChannel) return;

      const activeThreads = await forumChannel.threads.fetchActive();
      for (const [_, thread] of activeThreads.threads) {
        // Skip if thread is locked, already has a warning, or is marked as solved
        if (!thread.locked && 
            !ForumManager.inactivityWarnings.has(thread.id) && 
            !thread.appliedTags.includes(ForumManager.SOLVED_TAG_ID)) {
          const messages = await thread.messages.fetch({ limit: 10 }); // Fetch more messages to find non-bot ones
          
          // Find the last non-bot message
          const lastNonBotMessage = messages.find(msg => !msg.author.bot);
          const lastThreadOwnerMessage = messages.find(msg => msg.author.id === thread.ownerId);

          if (lastNonBotMessage && lastThreadOwnerMessage &&
              lastNonBotMessage.author.id !== thread.ownerId &&
              Date.now() - lastThreadOwnerMessage.createdTimestamp >= ForumManager.INACTIVITY_CHECK_DELAY) {
            await this.sendInactivityWarning(thread);
            ForumManager.inactivityWarnings.set(thread.id, true);
          }
        }
      }
    }, ForumManager.INACTIVITY_CHECK_DELAY);
  }

  private async sendInactivityWarning(thread: ThreadChannel) {
    const embed = new EmbedBuilder()
      .setColor(Colors.Yellow)
      .setDescription(`Hey <@${thread.ownerId}>, it seems like your last message was sent more than 24 hours ago.\nIf we don't hear back from you we'll assume the issue is resolved and mark your post as solved.`);

    const solveButton = new ButtonBuilder()
      .setCustomId('mark_solved')
      .setLabel('Issue already solved? Close post now')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(solveButton);

    const message = await thread.send({
      embeds: [embed],
      components: [row]
    });

    // Add button collector
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 24 * 60 * 60 * 1000 // 24 hour timeout
    });

    collector.on('collect', async (interaction: ButtonInteraction) => {
      if (interaction.customId === 'mark_solved') {
        // Check if user is thread owner or has the required role
        const hasRequiredRole = interaction.member?.roles instanceof GuildMemberRoleManager && 
          interaction.member.roles.cache.has('1022899638140928022');
        
        if (interaction.user.id !== thread.ownerId && !hasRequiredRole) {
          await interaction.reply({
            content: 'Only the original poster or moderators can mark a post as solved!',
            ephemeral: true
          });
          return;
        }

        await this.markAsSolved(thread);
        const closeTime = new Date(Date.now() + ForumManager.AUTO_CLOSE_DELAY);
        await interaction.reply({
          content: `Post has been marked as solved and will be closed ${time(closeTime, 'R')}.`,
          ephemeral: false
        });
      }
    });
  }

  public async handleSolvedCommand(interaction: ChatInputCommandInteraction) {
    if (!interaction.channel?.isThread()) {
      await interaction.reply({
        content: 'This command can only be used in forum posts!',
        ephemeral: true
      });
      return;
    }

    const thread = interaction.channel as ThreadChannel;
    const forumChannel = thread.parent as ForumChannel;

    if (forumChannel.id !== ForumManager.FORUM_CHANNEL_ID) {
      await interaction.reply({
        content: 'This command can only be used in the help forum!',
        ephemeral: true
      });
      return;
    }

    // Check if user is thread owner or has the required role
    const hasRequiredRole = interaction.member?.roles instanceof GuildMemberRoleManager && 
      interaction.member.roles.cache.has('1022899638140928022');
    if (thread.ownerId !== interaction.user.id && !hasRequiredRole) {
      await interaction.reply({
        content: 'Only the original poster or moderators can mark a post as solved!',
        ephemeral: true
      });
      return;
    }

    await this.markAsSolved(thread);
    
    const closeTime = new Date(Date.now() + ForumManager.AUTO_CLOSE_DELAY);
    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle('✅ Post Marked as Solved')
      .setDescription(`This post has been marked as solved by <@${interaction.user.id}>!\nUse \`/unsolved\` to remove this tag.`)
      .addFields({
        name: '🔒 Auto-close',
        value: `This post will be closed ${time(closeTime, 'R')} (${time(closeTime, 'f')}).`
      })
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      ephemeral: false
    });
  }

  public async handleUnsolvedCommand(interaction: ChatInputCommandInteraction) {
    if (!interaction.channel?.isThread()) {
      await interaction.reply({
        content: 'This command can only be used in forum posts!',
        ephemeral: true
      });
      return;
    }

    const thread = interaction.channel as ThreadChannel;
    const forumChannel = thread.parent as ForumChannel;

    if (forumChannel.id !== ForumManager.FORUM_CHANNEL_ID) {
      await interaction.reply({
        content: 'This command can only be used in the help forum!',
        ephemeral: true
      });
      return;
    }

    // Check if user is thread owner or has the required role
    const hasRequiredRole = interaction.member?.roles instanceof GuildMemberRoleManager && 
      interaction.member.roles.cache.has('1022899638140928022');
    if (thread.ownerId !== interaction.user.id && !hasRequiredRole) {
      await interaction.reply({
        content: 'Only the original poster or moderators can remove the solved status!',
        ephemeral: true
      });
      return;
    }

    // Clear any existing auto-close timer
    const existingTimer = ForumManager.activeThreads.get(thread.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      ForumManager.activeThreads.delete(thread.id);
    }

    // Remove the solved tag
    const appliedTags = thread.appliedTags.filter(tag => tag !== ForumManager.SOLVED_TAG_ID);
    await thread.setAppliedTags(appliedTags);

    const embed = new EmbedBuilder()
      .setColor(Colors.Blue)
      .setTitle('🔄 Solved Status Removed')
      .setDescription(`The solved tag has been removed from this post by <@${interaction.user.id}>.`)
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      ephemeral: false
    });
  }

  private async markAsSolved(thread: ThreadChannel) {
    // Add the solved tag if it's not already applied
    if (!thread.appliedTags.includes(ForumManager.SOLVED_TAG_ID)) {
      const newTags = [...thread.appliedTags, ForumManager.SOLVED_TAG_ID];
      await thread.setAppliedTags(newTags);
    }

    // Clear any existing timer
    const existingTimer = ForumManager.activeThreads.get(thread.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set up auto-close timer
    const timer = setTimeout(async () => {
      try {
        await thread.setLocked(true);
        const embed = new EmbedBuilder()
          .setColor(Colors.Grey)
          .setTitle('🔒 Post Closed')
          .setDescription('This post has been automatically closed.')
          .setTimestamp();
        
        await thread.send({ embeds: [embed] });
        ForumManager.activeThreads.delete(thread.id);
      } catch (error) {
        console.error('Error closing thread:', error);
      }
    }, ForumManager.AUTO_CLOSE_DELAY);

    ForumManager.activeThreads.set(thread.id, timer);
  }
} 