import 'package:flutter/material.dart';

void main() {
  runApp(const LifeHomeApp());
}

class LifeHomeApp extends StatelessWidget {
  const LifeHomeApp({super.key});

  @override
  Widget build(BuildContext context) {
    final colorScheme = ColorScheme.fromSeed(
      seedColor: const Color(0xFF116F4F),
      brightness: Brightness.light,
    );

    return MaterialApp(
      title: 'LIFE HOME AI',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: colorScheme,
        scaffoldBackgroundColor: const Color(0xFFF5F7F2),
        useMaterial3: true,
      ),
      home: const FoundationScreen(),
    );
  }
}

class FoundationScreen extends StatelessWidget {
  const FoundationScreen({super.key});

  static const capabilities = [
    (
      icon: Icons.verified_outlined,
      title: '검증된 매물',
      description: '중개사 자격과 매물 상태를 확인합니다.',
    ),
    (
      icon: Icons.calendar_month_outlined,
      title: '방문 예약',
      description: '문의부터 방문 일정까지 한곳에서 관리합니다.',
    ),
    (
      icon: Icons.description_outlined,
      title: '안전한 계약',
      description: '계약 버전과 서명 이력을 안전하게 보존합니다.',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        title: const Text(
          'LIFE HOME AI',
          style: TextStyle(fontWeight: FontWeight.w800),
        ),
        actions: const [
          Padding(
            padding: EdgeInsets.only(right: 16),
            child: Chip(
              avatar: Icon(Icons.circle, size: 10, color: Color(0xFF116F4F)),
              label: Text('ACTIVE'),
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 32, 20, 40),
          children: [
            Text(
              '집을 찾는 전 과정을\n더 안전하게.',
              style: Theme.of(context).textTheme.displaySmall?.copyWith(
                    height: 1.1,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -1.6,
                  ),
            ),
            const SizedBox(height: 16),
            Text(
              '검증된 부동산 검색부터 방문 예약과 계약까지 연결합니다.',
              style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                    color: const Color(0xFF5C6F67),
                    height: 1.6,
                  ),
            ),
            const SizedBox(height: 32),
            ...capabilities.map(
              (capability) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Card(
                  elevation: 0,
                  child: ListTile(
                    contentPadding: const EdgeInsets.all(18),
                    leading: CircleAvatar(
                      child: Icon(capability.icon),
                    ),
                    title: Text(
                      capability.title,
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    subtitle: Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text(capability.description),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
