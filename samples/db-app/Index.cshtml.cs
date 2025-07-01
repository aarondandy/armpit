using Dapper;

using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.Data.SqlClient;

namespace Numbers;

[IgnoreAntiforgeryToken]
public class IndexModel(IConfiguration config) : PageModel
{
    public long LargestKnownNumber { get; } = 45_000_000_000;

    [BindProperty]
    public long? Guess { get; set; }

    public GuessStatistics Stats { get; set; } = null!;

    public async Task OnGetAsync()
    {
        using var connection = CreateConnection();
        await LoadStats(connection);
    }

    public async Task OnPostAsync()
    {
        using var connection = CreateConnection();

        if (Guess > 1 && Guess <= LargestKnownNumber)
        {
            await connection.ExecuteAsync("INSERT INTO NumberSearch ([Value]) VALUES (@V)", new { V = Guess.Value });
        }

        await LoadStats(connection);
    }

    private SqlConnection CreateConnection() => new SqlConnection(config.GetConnectionString(Program.ConnectionStringKey));

    private async Task LoadStats(SqlConnection connection)
    {
        Stats = await connection.QuerySingleAsync<GuessStatistics>("SELECT COUNT(*) [Count], MIN([Value]) [Min], MAX([Value]) [Max] FROM [NumberSearch]");
    }

    public class GuessStatistics
    {
        public long Count;
        public long Min;
        public long Max;
    }
}
