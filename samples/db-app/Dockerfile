FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY ["Numbers.csproj", "."]
RUN dotnet restore
COPY . .
WORKDIR "/src"
RUN dotnet build "Numbers.csproj" -c Release -o /app/build

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
COPY --from=build /app/build .
ENTRYPOINT ["dotnet", "Numbers.dll"]
