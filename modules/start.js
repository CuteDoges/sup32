const { Mal } = require('node-myanimelist');
const Enmap = require('enmap');
const Promise = require('bluebird');
const youtubeDownload = require('ytdl-core-discord');
const youtubeSearchApi = require('simple-youtube-api');

exports.run = async (client, message) => {
    const setting = client.setting.get(message.guild.id);

    if (!message.guild.channels.has(setting.quizVoiceChannel) || !message.guild.channels.has(setting.quizTextChannel))
        return message.channel.send("Cannot start a game. Please setup your channels first.");

    if (message.channel.id !== setting.quizTextChannel)
        return message.channel.send(`Can only start the game in <#${setting.quizTextChannel}>! Use the command there again.`);

    var season = require('../test/season.json'); // await Mal.season(setting.animeYear, setting.animeSeason);

    var options = {
        voiceChannel: message.guild.channels.get(setting.quizVoiceChannel),
        textChannel: message.guild.channels.get(setting.quizTextChannel),
        list: season.anime.filter(show => show.type == "TV" && show.kids == false),
        token: client.config.google_token
    }

    var manager = new GameManager(options);

    await manager.init();
}

class GameManager {
    constructor(options = {}) {
        this.voiceChannel = options.voiceChannel;
        this.textChannel = options.textChannel;
        this.searchApi = new youtubeSearchApi(options.token);
        this.scores = new Enmap();
        this.rounds = new Enmap();
        this.connection = undefined;
        this.animeList = options.list

        this.tvSizePlaytime = 90;
        this.roundLength = options.roundLength || 20;
        this.roundsMax = options.roundsMax || 5;
        this.currentRound = 1;
    }

    async init() {
        this.connection = await this.voiceChannel.join();
        this.rounds.set(this.currentRound, await this.getRandomAnime());
        await this.start();
    } 

    async start() {
        console.log(`::start() -> Started round ${this.currentRound}`);

        if (this.currentRound <= this.roundsMax)
            this.rounds.set(this.currentRound + 1, await this.getRandomAnime());
        
        var round = this.rounds.get(this.currentRound);
        var answers = this.getPossibleAnswers(round.anime);
        var answerers = [];

        const filter = msg => answers.includes(msg.content.trim().toLowerCase());
        const collector = this.textChannel.createMessageCollector(filter, { time: (this.roundLength + 5) * 1000 });
        collector.on('collect', msg => {
            var author = msg.author.id;

            if (answerers.includes(author))
                return;

            if (!this.scores.has(author))
                this.scores.set(author, 1);
            else
                this.scores.set(author, this.scores.get(author) + 1);

            answerers.push(author);
        });
        collector.on('end', async() => {
            const embed = {
                "author": {
                    "name": round.anime.title,
                    "url": round.anime.url
                },
                "color": 5624201,
                "footer": {
                    "text": round.anime.premiered
                },
                "image": {
                    "url": round.anime.image_url
                }
            };

            await this.textChannel.send("And the answer is...", { embed });
            await this.textChannel.send(`${(answerers.length > 0) ? answerers.map(id => `<#${id}>`).join(', ') : "Nobody"} got the correct answer!`);
            await Promise.delay(5000);

            if (this.currentRound < this.roundsMax)
                return await this.finish();
            else
                return await this.start();
        });

        this.textChannel.send(`**Round #${this.currentRound}!**`);
        await this.playTrackPreview(round.track);
    }

    async finish() {
        console.log(`::finish() -> Game ended.`);

        this.textChannel.send("The game has ended! Thank you for playing.");
        this.voiceChannel.leave();
    }

    async getRandomAnime() {
        var anime = this.animeList[getRandomInt(0, this.animeList.length - 1)];
        var data = await Mal.anime(anime.mal_id);

        var query = await this.searchApi.searchVideos(this.getSearchQuery(data), 1);

        if (query.length < 1)
            return await this.getRandomAnime();

        var track = await youtubeDownload(query[0].shortURL);

        console.log(`::getRandomAnime() -> ${anime.title}`);

        return { 
            anime: data,
            query: query,
            track: track 
        };
    }

    async playTrackPreview(track) {
        var options = {
            seek: getRandomInt(0, this.tvSizePlaytime - this.roundLength),
            bitrate: 'auto'
        }
    
        var dispatcher = await this.voiceChannel.connection.playOpusStream(track, options);
        dispatcher.on('start', async () => {
            await Promise.delay(this.roundLength * 1000);
            dispatcher.pause();
        });
    }

    getPossibleAnswers(anime) {
        var answers = [];
        [
            "title",
            "title_english",
            "title_japanese"
        ].forEach(prop => {
            if (typeof anime[prop] == 'string')
                answers.push(anime[prop]);
        });

        return answers.concat(anime.title_synonyms).map((a) => a.toLowerCase());
    }

    getSearchQuery(anime) {
        const types = [ "opening_themes", "ending_themes" ];
        const themes = anime[types[getRandomInt(0, 1)]];
    
        return themes[getRandomInt(0, themes.length - 1)];
    }
}

function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);

    return Math.floor(Math.random() * (max - min)) + min;
}