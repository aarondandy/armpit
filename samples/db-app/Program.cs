using Dapper;

using Microsoft.Data.SqlClient;

namespace Numbers;

class Program
{
    public static string ConnectionStringKey { get; } = "MyDatabase";

    static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);
        builder.Services.AddRazorPages(o => o.RootDirectory = "/");
        builder.Services.AddHostedService<DbBootstrapper>();
        var app = builder.Build();
        app.UseStaticFiles();
        app.MapRazorPages();
        app.Run();
    }

    private class DbBootstrapper(IConfiguration config) : IHostedService
    {
        public async Task StartAsync(CancellationToken cancellationToken)
        {
            using var connection = new SqlConnection(config.GetConnectionString(ConnectionStringKey));
            await connection.ExecuteAsync(
            """
            IF OBJECT_ID('NumberSearch', 'U') IS NULL CREATE TABLE NumberSearch ([Value] BIGINT NOT NULL);
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_NumberSearch_Value' AND object_id = OBJECT_ID('NumberSearch')) CREATE CLUSTERED INDEX IX_NumberSearch_Value ON NumberSearch ([Value]);
            """);
        }
        public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    }
}
