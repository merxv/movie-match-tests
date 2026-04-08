const { expect, driver } = require('@wdio/globals')
const LoginPage = require('../pageobjects/login.page')
const MoviesPage = require('../pageobjects/movies.page')
const ProfilePage = require('../pageobjects/profile.page')
const RecommendationsPage = require('../pageobjects/recommendations.page')
const SearchResultsPage = require('../pageobjects/search-results.page')
const GenresPage = require('../pageobjects/genres.page')
const GenreResultsPage = require('../pageobjects/genre-results.page')

describe('S01 Authentication', () => {
    const VALID_LOGIN = 'steve@example.com'
    const VALID_PASSWORD = '123'

    const INVALID_LOGIN = 'steve@example.com'
    const INVALID_PASSWORD = '456'

    beforeEach(async () => {
        await browser.url('/')
        await browser.execute(() => window.localStorage.clear())
    })

    it('TC01 Valid login', async () => {
        await LoginPage.open()

        await expect(LoginPage.inputEmail).toBeDisplayed()
        await expect(LoginPage.inputPassword).toBeDisplayed()

        await LoginPage.login(VALID_LOGIN, VALID_PASSWORD)

        await MoviesPage.waitForLoaded()
        await expect(browser).toHaveUrl(expect.stringContaining('/movies'))
    })

    it('TC02 Invalid login', async () => {
        await LoginPage.open()

        await expect(LoginPage.inputEmail).toBeDisplayed()
        await expect(LoginPage.inputPassword).toBeDisplayed()

        await LoginPage.login(INVALID_LOGIN, INVALID_PASSWORD)

        await expect(LoginPage.errorMessage).toBeDisplayed()
    })
})

describe('S02 Recommendation', () => {
    const VALID_LOGIN = 'steve@example.com'
    const VALID_PASSWORD = '123'

    beforeEach(async () => {
        await browser.url('/')
        await browser.execute(() => window.localStorage.clear())
    })

    it('TC03 Get recommendations', async () => {
        await LoginPage.open()

        await expect(LoginPage.inputEmail).toBeDisplayed()
        await expect(LoginPage.inputPassword).toBeDisplayed()

        await LoginPage.login(VALID_LOGIN, VALID_PASSWORD)

        await MoviesPage.waitForLoaded()
        await MoviesPage.goToRecommendations()
        await RecommendationsPage.waitForLoaded()

        await expect(browser).toHaveUrl(expect.stringContaining('/recommendations'))
        await expect(RecommendationsPage.heading).toBeDisplayed()
        await expect(RecommendationsPage.errorMessage).not.toBeExisting()
        await expect(RecommendationsPage.emptyState).not.toBeExisting()
        await expect(RecommendationsPage.cards).toBeElementsArrayOfSize({ gte: 1 })
    })
})

describe('S05 Like/Unlike API', () => {
    const VALID_LOGIN = 'steve@example.com'
    const VALID_PASSWORD = '123'

    beforeEach(async () => {
        await browser.url('/')
        await browser.execute(() => window.localStorage.clear())
    })

    it('TC06 Like movie', async () => {
        await LoginPage.open()

        await expect(LoginPage.inputEmail).toBeDisplayed()
        await expect(LoginPage.inputPassword).toBeDisplayed()

        await LoginPage.login(VALID_LOGIN, VALID_PASSWORD)

        await MoviesPage.waitForLoaded()
        const movieTitle = await MoviesPage.likeFirstUnlikedMovie()

        await MoviesPage.goToProfile()
        await ProfilePage.waitForLoaded()

        await expect(browser).toHaveUrl(expect.stringContaining('/profile'))
        await expect(ProfilePage.heading).toBeDisplayed()
        await expect(ProfilePage.errorMessage).not.toBeExisting()
        await expect(await ProfilePage.hasMovie(movieTitle)).toBe(true)
    })

    it('TC07 Unlike movie', async () => {
        await LoginPage.open()

        await expect(LoginPage.inputEmail).toBeDisplayed()
        await expect(LoginPage.inputPassword).toBeDisplayed()

        await LoginPage.login(VALID_LOGIN, VALID_PASSWORD)

        await MoviesPage.waitForLoaded()
        await driver.pause(500)
        const movieTitle = await MoviesPage.likeFirstUnlikedMovie()

        await MoviesPage.goToProfile()
        await ProfilePage.waitForLoaded()

        await expect(ProfilePage.errorMessage).not.toBeExisting()

        await expect(await ProfilePage.hasMovie(movieTitle)).toBe(true)
        await ProfilePage.unlikeMovie(movieTitle)
        await expect(await ProfilePage.hasMovie(movieTitle)).toBe(false)
    })
})

describe('S06 Search', () => {
    const VALID_LOGIN = 'steve@example.com'
    const VALID_PASSWORD = '123'
    const GENRE = 'Sci-Fi'

    beforeEach(async () => {
        await browser.url('/')
        await browser.execute(() => window.localStorage.clear())
    })

    it('TC08 Search query', async () => {
        await LoginPage.open()

        await expect(LoginPage.inputEmail).toBeDisplayed()
        await expect(LoginPage.inputPassword).toBeDisplayed()

        await LoginPage.login(VALID_LOGIN, VALID_PASSWORD)

        await MoviesPage.waitForLoaded()
        await driver.pause(1000)
        const firstMovieTitle = await MoviesPage.getFirstMovieTitle()
        const searchQuery = firstMovieTitle.split(' ')[0]

        await MoviesPage.search(searchQuery)
        await SearchResultsPage.waitForLoaded()

        await expect(browser).toHaveUrl(expect.stringContaining('/search/'))
        await expect(SearchResultsPage.heading).toBeDisplayed()
        await expect(SearchResultsPage.errorMessage).not.toBeExisting()
        await expect(SearchResultsPage.emptyState).not.toBeExisting()
        await expect(SearchResultsPage.resultCards).toBeElementsArrayOfSize({ gte: 1 })

        const resultTitles = await SearchResultsPage.getResultTitles()
        expect(resultTitles.some((title) => title.toLowerCase().includes(searchQuery.toLowerCase()))).toBe(true)
    })

    it('TC13 Search – Filter movies by genre', async () => {
        await LoginPage.open()

        await expect(LoginPage.inputEmail).toBeDisplayed()
        await expect(LoginPage.inputPassword).toBeDisplayed()

        await LoginPage.login(VALID_LOGIN, VALID_PASSWORD)

        await MoviesPage.waitForLoaded()
        await MoviesPage.goToGenres()
        await GenresPage.waitForLoaded()

        await GenresPage.selectGenre(GENRE)
        await GenreResultsPage.waitForLoaded(GENRE)

        await expect(browser).toHaveUrl(expect.stringContaining(`/genres/${encodeURIComponent(GENRE)}`))
        await expect(GenreResultsPage.headingForGenre(GENRE)).toBeDisplayed()
        await expect(GenreResultsPage.errorMessage).not.toBeExisting()
        await expect(GenreResultsPage.emptyState).not.toBeExisting()
        await expect(GenreResultsPage.resultCards).toBeElementsArrayOfSize({ gte: 1 })

        const resultGenres = await GenreResultsPage.getResultGenres()
        expect(resultGenres.every((text) => text.toLowerCase().includes(GENRE.toLowerCase()))).toBe(true)
    })

    it('TC14 Search – Empty search string', async () => {
        await LoginPage.open()

        await expect(LoginPage.inputEmail).toBeDisplayed()
        await expect(LoginPage.inputPassword).toBeDisplayed()

        await LoginPage.login(VALID_LOGIN, VALID_PASSWORD)

        await MoviesPage.waitForLoaded()
        const initialMovieCount = await MoviesPage.getMovieCount()

        await MoviesPage.search('')
        await MoviesPage.waitForLoaded()

        await expect(browser).toHaveUrl(expect.stringContaining('/movies'))
        await expect(await MoviesPage.getMovieCount()).toBe(initialMovieCount)
    })
})
